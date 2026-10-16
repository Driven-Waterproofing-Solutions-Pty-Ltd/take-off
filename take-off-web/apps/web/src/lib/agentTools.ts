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

interface PngResult {
  base64: string;
  outWidth: number;
  outHeight: number;
  downscale: number; // out/in factor; < 1 when image was shrunk to fit MAX_IMAGE_EDGE
}

// Upper bound on the full-page raster we ask MuPDF for. get_page_image takes
// a dpi of up to 300; an A0 sheet at 300 dpi would be ~140 MP (~560 MB RGBA),
// so the effective render scale is capped and reported back to the model.
const MAX_RENDER_PIXELS = 24_000_000;

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pixelsToPngBase64(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  crop: PixelRect = { x: 0, y: 0, width, height }
): PngResult {
  // Draw the RGBA pixmap to an offscreen canvas, crop to `crop`, downscale if
  // needed, export PNG.
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

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(crop.width, crop.height));
  const outWidth = Math.max(1, Math.round(crop.width * scale));
  const outHeight = Math.max(1, Math.round(crop.height * scale));
  const out = document.createElement('canvas');
  out.width = outWidth;
  out.height = outHeight;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('2d context unavailable');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, crop.x, crop.y, crop.width, crop.height, 0, 0, outWidth, outHeight);
  const dataUrl = out.toDataURL('image/png');
  return {
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    outWidth,
    outHeight,
    downscale: scale,
  };
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
        // Honour the tool contract (tool-schemas get_page_image): `dpi`
        // (72–300, default 150; 72 dpi = 1 image px per PDF point) and an
        // optional `viewport` {x, y, width, height} in PDF points to crop to.
        // Every coordinate the model reads off the delivered image is mapped
        // back to PDF points with the offset + factor reported below, which is
        // the space add_area / add_linear / add_count / add_arc /
        // set_scale_manual expect.
        const dims = mupdfController.getPageDimensions(resolved.localIndex);
        if (!(dims.width > 0 && dims.height > 0)) {
          return textResult(id, `Page ${pageIndex} has no renderable area`, true);
        }
        const dpiInput = Number(input.dpi ?? 150);
        const dpi = Number.isFinite(dpiInput) ? Math.min(300, Math.max(72, dpiInput)) : 150;
        const maxScale = Math.sqrt(MAX_RENDER_PIXELS / (dims.width * dims.height));
        const renderScale = Math.min(dpi / 72, maxScale);

        // Viewport in PDF points, clamped to the page.
        const vp = input.viewport as Partial<Record<'x' | 'y' | 'width' | 'height', unknown>> | undefined;
        let region = { x: 0, y: 0, width: dims.width, height: dims.height };
        if (vp) {
          const vx = Math.max(0, Math.min(dims.width, Number(vp.x)));
          const vy = Math.max(0, Math.min(dims.height, Number(vp.y)));
          const vw = Math.min(dims.width - vx, Number(vp.width));
          const vh = Math.min(dims.height - vy, Number(vp.height));
          if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) {
            return textResult(
              id,
              `viewport must lie within the page (0..${dims.width.toFixed(1)} × 0..${dims.height.toFixed(1)} PDF points) and have a positive width/height`,
              true
            );
          }
          region = { x: vx, y: vy, width: vw, height: vh };
        }

        const { pixels, width, height } = mupdfController.renderPageToImageData(
          resolved.localIndex,
          renderScale
        );
        const crop: PixelRect = {
          x: Math.floor(region.x * renderScale),
          y: Math.floor(region.y * renderScale),
          width: 0,
          height: 0,
        };
        crop.width = Math.max(1, Math.min(width - crop.x, Math.ceil(region.width * renderScale)));
        crop.height = Math.max(1, Math.min(height - crop.y, Math.ceil(region.height * renderScale)));
        const png = pixelsToPngBase64(pixels, width, height, crop);
        // Effective image-px-per-PDF-point factor = render scale × any
        // downscale applied to fit MAX_IMAGE_EDGE. The crop origin (in PDF
        // points) is the offset to add back.
        const effectiveScale = renderScale * png.downscale;
        const originX = crop.x / renderScale;
        const originY = crop.y / renderScale;
        const notes = [
          renderScale < dpi / 72 ? `rendered at ${(renderScale * 72).toFixed(0)} dpi (capped from ${dpi})` : `rendered at ${dpi} dpi`,
          png.downscale < 1 ? `downscaled by ${png.downscale.toFixed(4)} to fit vision input` : null,
          vp ? `cropped to viewport x=${originX.toFixed(2)} y=${originY.toFixed(2)} w=${region.width.toFixed(2)} h=${region.height.toFixed(2)} (PDF points)` : null,
        ].filter((n): n is string => n !== null);
        return {
          type: 'tool_result',
          tool_use_id: id,
          content: [
            {
              type: 'text',
              text:
                `Page ${pageIndex} (${dims.width.toFixed(1)}×${dims.height.toFixed(1)} PDF points) delivered at ${png.outWidth}x${png.outHeight}px; ${notes.join('; ')}. ` +
                `To convert an image pixel (u, v) to PDF points use x = ${originX.toFixed(4)} + u / ${effectiveScale.toFixed(6)}, ` +
                `y = ${originY.toFixed(4)} + v / ${effectiveScale.toFixed(6)}, and pass PDF points to ` +
                `add_area / add_linear / add_count / add_arc / set_scale_manual.`,
            },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.base64 } },
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
        // turned cutouts into positive areas. `shape_id` (on every add-shape
        // tool) lets a retried call upsert the same shape instead of adding
        // a duplicate that double-counts the quantity.
        const out = await api.shapes.area({
          project_id: pid,
          page_index: Number(input.page_index),
          points: input.points as Point[],
          item_id: input.item_id as string | undefined,
          shape_id: input.shape_id as string | undefined,
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
          shape_id: input.shape_id as string | undefined,
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
          shape_id: input.shape_id as string | undefined,
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
          shape_id: input.shape_id as string | undefined,
          name: input.name as string | undefined,
          color: input.color as string | undefined,
          deduction: input.deduction as boolean | undefined,
        });
        return textResult(id, out);
      }

      case 'snap_to_vector': {
        // /api/measure/snap takes and returns PDF-point coordinates (the
        // worker converts to/from vector-cache space itself, same as the MCP
        // handler), so forward the agent's points untouched.
        const out = await api.snap({
          project_id: pid,
          page_index: Number(input.page_index),
          points: (input.points as Point[]) ?? [],
          tolerance_px: input.tolerance_px as number | undefined,
        });
        return textResult(id, out);
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
        const out = await api.memory.listAssemblies({
          tag: typeof input.tag === 'string' ? input.tag : undefined,
        });
        return textResult(id, out);
      }

      case 'get_takeoff_knowledge': {
        const out = await api.memory.getTakeoffKnowledge({
          topic: input.topic as string | undefined,
          builder: input.builder as string | undefined,
        });
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
