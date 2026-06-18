import { api } from './api';
import { mupdfController } from '../utils/mupdfController';
import type { Point } from '../types';

// Browser-side executor for the tool_use blocks Claude returns from
// /api/ai/turn. Each tool maps to the same `api.*` call the canvas uses, so
// agent-driven writes flow through the identical REST surface and show up on
// the canvas live via the existing sync hooks. See takeoff-agent-design.md.

export interface AgentToolContext {
  projectId: string;
  // Map a project-wide page index → the plan set + local PDF page index
  // (mirrors getActivePlanDetails in App.tsx). Returns null when the global
  // index lies outside every uploaded plan set.
  resolveLocalPageIndex: (globalPageIndex: number) => { planSetId: string; localIndex: number } | null;
  // Plan set currently loaded into the shared mupdfController. get_page_image
  // can only render pages from that set; a request for a page in any other
  // uploaded plan set would otherwise render the wrong PDF entirely.
  activePlanSetId: string | null;
}

// Claude vision works best with the longest edge ≤ ~1568px. AutoCAD A3 sheets
// render much larger; downscale before sending so we don't waste tokens or
// trip the model's image-resize.
const MAX_IMAGE_EDGE = 1568;

// Vector cache (used by snap_to_vector) lives in 2× content-pixel space —
// see vectorExtractor.ts and the canvas's shapeRenderScale. The agent works
// in PDF-point space (matches add_*/set_scale_*); scale points across that
// boundary when calling snap so the agent never sees the discrepancy.
const VECTOR_CACHE_SCALE = 2;

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  >;
  is_error?: boolean;
}

function pixelsToPngBase64(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): string {
  // Draw the RGBA pixmap to an offscreen canvas, downscale if needed, export PNG.
  const src = document.createElement('canvas');
  src.width = width;
  src.height = height;
  const sctx = src.getContext('2d');
  if (!sctx) throw new Error('2d context unavailable');
  // MuPDF's pixel buffer can be SharedArrayBuffer-backed; ImageData needs a
  // plain ArrayBuffer, so copy into a fresh Uint8ClampedArray.
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.set(pixels);
  sctx.putImageData(new ImageData(rgba, width, height), 0, 0);

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  let out = src;
  if (scale < 1) {
    out = document.createElement('canvas');
    out.width = Math.round(width * scale);
    out.height = Math.round(height * scale);
    const octx = out.getContext('2d');
    if (!octx) throw new Error('2d context unavailable');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(src, 0, 0, out.width, out.height);
  }
  const dataUrl = out.toDataURL('image/png');
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

function textResult(id: string, payload: unknown, isError = false): ToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: id,
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
    is_error: isError,
  };
}

// Execute a single tool_use block and return the tool_result block to feed
// back into the next /api/ai/turn call.
export async function executeAgentTool(
  block: ToolUseBlock,
  ctx: AgentToolContext
): Promise<ToolResultBlock> {
  const { name, input, id } = block;
  const pid = ctx.projectId;

  try {
    switch (name) {
      case 'get_page_image': {
        const pageIndex = Number(input.page_index ?? 0);
        const resolved = ctx.resolveLocalPageIndex(pageIndex);
        if (!resolved) return textResult(id, `No PDF page for index ${pageIndex}`, true);
        // mupdfController only holds ONE document at a time (the canvas's
        // currently-loaded plan set). If the agent asks for a page in a
        // different uploaded set, rendering would silently use whichever PDF
        // is already loaded and return the wrong drawing — every measurement
        // off that image would then be wrong. Refuse and tell the agent to
        // switch the active page first.
        if (ctx.activePlanSetId && resolved.planSetId !== ctx.activePlanSetId) {
          return textResult(
            id,
            `Page ${pageIndex} belongs to a different plan set than the one currently loaded on the canvas. Ask the user to switch to that plan set / page first, then call get_page_image again.`,
            true
          );
        }
        // Default to 1× = PDF-point space, which matches the coordinate
        // space the worker expects for add_area / add_linear / add_count /
        // add_arc / set_scale_manual. Rendering at 2× and forwarding raw
        // pixel coords (the previous default) overstated quantities 4× on
        // preset scales and double-sized the saved geometry on reload
        // (the canvas multiplies stored points by shapeRenderScale=2).
        const renderScale = Number(input.render_scale ?? 1.0);
        const { pixels, width, height } = mupdfController.renderPageToImageData(
          resolved.localIndex,
          renderScale
        );
        const data = pixelsToPngBase64(pixels, width, height);
        return {
          type: 'tool_result',
          tool_use_id: id,
          content: [
            {
              type: 'text',
              text: `Page ${pageIndex} rendered at ${width}x${height}px. Coordinates you propose should be in PDF-point space — i.e. divide image-pixel coordinates by ${renderScale} before passing them to add_area / add_linear / add_count / add_arc / set_scale_manual.`,
            },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
          ],
        };
      }

      case 'set_scale_preset': {
        const out = await api.scale.preset(pid, Number(input.page_index), String(input.preset_label));
        return textResult(id, out);
      }

      case 'set_scale_manual': {
        const out = await api.scale.manual(
          pid,
          Number(input.page_index),
          input.p1 as Point,
          input.p2 as Point,
          Number(input.real_distance),
          String(input.unit)
        );
        return textResult(id, out);
      }

      case 'add_area': {
        // Forward `name`/`color`/`deduction` — the shared tool schema, REST,
        // and worker shape row all accept them. When no item_id is provided,
        // the server creates a new item using `name` as the label and `color`
        // for legends. Dropping these turned agent-named scopes ("Parapet
        // flashing") into generic auto-labels in quotes; dropping `deduction`
        // turned cutouts into positive areas.
        const out = await api.shapes.area({
          project_id: pid,
          page_index: Number(input.page_index),
          points: input.points as Point[],
          item_id: input.item_id as string | undefined,
          name: input.name as string | undefined,
          color: input.color as string | undefined,
          snap: input.snap as boolean | undefined,
          deduction: input.deduction as boolean | undefined,
        });
        return textResult(id, out);
      }

      case 'add_linear': {
        const out = await api.shapes.linear({
          project_id: pid,
          page_index: Number(input.page_index),
          points: input.points as Point[],
          item_id: input.item_id as string | undefined,
          name: input.name as string | undefined,
          color: input.color as string | undefined,
          snap: input.snap as boolean | undefined,
          deduction: input.deduction as boolean | undefined,
        });
        return textResult(id, out);
      }

      case 'add_count': {
        const out = await api.shapes.count({
          project_id: pid,
          page_index: Number(input.page_index),
          points: input.points as Point[],
          item_id: input.item_id as string | undefined,
          name: input.name as string | undefined,
          color: input.color as string | undefined,
          deduction: input.deduction as boolean | undefined,
        });
        return textResult(id, out);
      }

      case 'add_arc': {
        const out = await api.shapes.arc({
          project_id: pid,
          page_index: Number(input.page_index),
          start: input.start as Point,
          end: input.end as Point,
          bulge: Number(input.bulge),
          item_id: input.item_id as string | undefined,
          name: input.name as string | undefined,
          color: input.color as string | undefined,
          deduction: input.deduction as boolean | undefined,
        });
        return textResult(id, out);
      }

      case 'snap_to_vector': {
        // Agent works in PDF-point space; vector cache lives in 2× space.
        // Scale across the boundary so the snap is meaningful — otherwise
        // every PDF-point coord lands ~8 px from the nearest cache vertex
        // and snap silently returns the input untouched.
        const requested = (input.points as Point[]) ?? [];
        const scaled = requested.map((p) => ({
          x: p.x * VECTOR_CACHE_SCALE,
          y: p.y * VECTOR_CACHE_SCALE,
        }));
        const out = await api.snap({
          project_id: pid,
          page_index: Number(input.page_index),
          points: scaled,
          tolerance_px: input.tolerance_px as number | undefined,
        });
        return textResult(id, {
          ...out,
          snapped: out.snapped.map((p) => ({
            x: p.x / VECTOR_CACHE_SCALE,
            y: p.y / VECTOR_CACHE_SCALE,
          })),
        });
      }

      case 'list_items': {
        const out = await api.items.list(pid);
        return textResult(id, out);
      }

      case 'search_projects': {
        const out = await api.memory.searchProjects(String(input.query));
        return textResult(id, out);
      }

      case 'recall_customer': {
        const out = await api.memory.searchCustomers(String(input.query));
        return textResult(id, out);
      }

      case 'list_assemblies': {
        const out = await api.memory.listAssemblies();
        return textResult(id, out);
      }

      case 'apply_assembly': {
        // Route through the validated /api/memory/apply-assembly endpoint —
        // it checks the assembly row exists before stamping its id on the
        // item. The raw api.items.update path writes the id without checking;
        // a stale or hallucinated assembly_id then makes buildQuote skip the
        // item (no assembly lines + no price/sub-item fallback) so the item
        // silently vanishes from the draft quote.
        const out = await api.memory.applyAssembly({
          project_id: pid,
          item_id: String(input.item_id),
          assembly_id: String(input.assembly_id),
        });
        return textResult(id, out);
      }

      case 'build_quote': {
        const out = await api.memory.quote(pid);
        return textResult(id, out);
      }

      case 'pull_xero_invoice': {
        const out = await api.xero.pullInvoice({
          invoice_id: input.invoice_id as string | undefined,
          invoice_number: input.invoice_number as string | undefined,
        });
        return textResult(id, out);
      }

      default:
        // push_to_xero is intentionally absent — it's gated behind the human
        // review panel, never the model.
        return textResult(id, `Tool not available to the agent: ${name}`, true);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return textResult(id, `Error executing ${name}: ${message}`, true);
  }
}

// Run every tool_use block in an assistant turn, returning the user-role
// message (array of tool_result blocks) to append before the next turn.
// `isAborted` lets the caller (useTakeoffAgent) interrupt between tools so
// clicking Stop mid-turn doesn't run every remaining mutating tool in the
// batch — Claude can emit multiple parallel tool_use blocks per turn.
export async function executeAgentTurn(
  content: Array<Record<string, unknown>>,
  ctx: AgentToolContext,
  isAborted?: () => boolean
): Promise<{ toolResults: ToolResultBlock[]; ranTools: boolean }> {
  const toolUses = content.filter((b) => b.type === 'tool_use') as unknown as ToolUseBlock[];
  if (toolUses.length === 0) return { toolResults: [], ranTools: false };
  const toolResults: ToolResultBlock[] = [];
  for (const block of toolUses) {
    if (isAborted?.()) {
      toolResults.push(textResult(block.id, 'Aborted by user before execution', true));
      continue;
    }
    toolResults.push(await executeAgentTool(block, ctx));
  }
  return { toolResults, ranTools: true };
}
