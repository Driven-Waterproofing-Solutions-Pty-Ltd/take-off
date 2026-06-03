import { api } from './api';
import { mupdfController } from '../utils/mupdfController';
import type { Point } from '../types';

// Browser-side executor for the tool_use blocks Claude returns from
// /api/ai/turn. Each tool maps to the same `api.*` call the canvas uses, so
// agent-driven writes flow through the identical REST surface and show up on
// the canvas live via the existing sync hooks. See takeoff-agent-design.md.

export interface AgentToolContext {
  projectId: string;
  // Map a project-wide page index → the local page index within the loaded
  // PDF (so get_page_image renders the right page). Mirrors
  // getActivePlanDetails in App.tsx.
  resolveLocalPageIndex: (globalPageIndex: number) => number | null;
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
        const local = ctx.resolveLocalPageIndex(pageIndex);
        if (local == null) return textResult(id, `No PDF page for index ${pageIndex}`, true);
        const renderScale = Number(input.render_scale ?? 2.0);
        const { pixels, width, height } = mupdfController.renderPageToImageData(local, renderScale);
        const data = pixelsToPngBase64(pixels, width, height);
        return {
          type: 'tool_result',
          tool_use_id: id,
          content: [
            {
              type: 'text',
              text: `Page ${pageIndex} rendered at ${width}x${height}px (content-pixel space, RENDER_SCALE=${renderScale}). Coordinates you propose should be in this pixel space.`,
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
        const out = await api.shapes.area({
          project_id: pid,
          page_index: Number(input.page_index),
          points: input.points as Point[],
          item_id: input.item_id as string | undefined,
          name: input.name as string | undefined,
          snap: input.snap as boolean | undefined,
        });
        return textResult(id, out);
      }

      case 'add_linear': {
        const out = await api.shapes.linear({
          project_id: pid,
          page_index: Number(input.page_index),
          points: input.points as Point[],
          item_id: input.item_id as string | undefined,
          snap: input.snap as boolean | undefined,
        });
        return textResult(id, out);
      }

      case 'add_count': {
        const out = await api.shapes.count({
          project_id: pid,
          page_index: Number(input.page_index),
          points: input.points as Point[],
          item_id: input.item_id as string | undefined,
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
        });
        return textResult(id, out);
      }

      case 'snap_to_vector': {
        const out = await api.snap({
          project_id: pid,
          page_index: Number(input.page_index),
          points: input.points as Point[],
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
        const out = await api.memory.listAssemblies();
        return textResult(id, out);
      }

      case 'apply_assembly': {
        const out = await api.items.update(String(input.item_id), {
          assembly_id: String(input.assembly_id),
        });
        return textResult(id, out);
      }

      case 'build_quote': {
        const out = await api.memory.quote(pid);
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
export async function executeAgentTurn(
  content: Array<Record<string, unknown>>,
  ctx: AgentToolContext
): Promise<{ toolResults: ToolResultBlock[]; ranTools: boolean }> {
  const toolUses = content.filter((b) => b.type === 'tool_use') as unknown as ToolUseBlock[];
  if (toolUses.length === 0) return { toolResults: [], ranTools: false };
  const toolResults: ToolResultBlock[] = [];
  for (const block of toolUses) {
    toolResults.push(await executeAgentTool(block, ctx));
  }
  return { toolResults, ranTools: true };
}
