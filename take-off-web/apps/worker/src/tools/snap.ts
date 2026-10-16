import type { Env } from '../env';
import { Point } from '@takeoff/shared';
import { getPage } from '../db/queries';

interface VectorCache {
  vertices: Point[];
  segments: Array<{ a: Point; b: Point }>;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function snapOne(p: Point, cache: VectorCache, tolerance: number): Point {
  let best = p;
  let bestDist = tolerance;

  for (const v of cache.vertices) {
    const d = distance(p, v);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  for (const seg of cache.segments) {
    const proj = pointOnSegment(p, seg.a, seg.b);
    const d = distance(p, proj);
    if (d < bestDist) {
      best = proj;
      bestDist = d;
    }
  }
  return best;
}

function isVectorCache(x: unknown): x is VectorCache {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  return Array.isArray(c.vertices) && Array.isArray(c.segments);
}

export async function snapToVector(
  env: Env,
  args: { project_id: string; page_index: number; points: Point[]; tolerance_px?: number }
): Promise<{ snapped: Point[] }> {
  const page = await getPage(env.DB, args.project_id, args.page_index);
  if (!page?.vector_cache_json) {
    return { snapped: args.points };
  }
  let cache: VectorCache;
  try {
    const parsed = JSON.parse(page.vector_cache_json);
    if (!isVectorCache(parsed)) return { snapped: args.points };
    cache = parsed;
  } catch {
    return { snapped: args.points };
  }
  const tol = args.tolerance_px ?? 8;
  const snapped = args.points.map((p) => snapOne(p, cache, tol));
  return { snapped };
}

// The vector cache is uploaded from the canvas in RENDER_SCALE × PDF-point
// space (see apps/web/src/utils/vectorExtractor.ts), but every public caller
// (REST /api/measure/snap, MCP snap_to_vector, add_area/add_linear) works in
// PDF-point space — the same space shapes are stored in. Scale across that
// boundary in ONE place so a point near PDF (100, 100) is compared against
// cache geometry near (200, 200) and the snapped result comes back in PDF
// points. `tolerance_px` stays in cache pixels (unchanged contract).
export const VECTOR_CACHE_SCALE = 2;

export async function snapPdfPoints(
  env: Env,
  args: { project_id: string; page_index: number; points: Point[]; tolerance_px?: number }
): Promise<{ snapped: Point[] }> {
  const { snapped } = await snapToVector(env, {
    ...args,
    points: args.points.map((p) => ({ x: p.x * VECTOR_CACHE_SCALE, y: p.y * VECTOR_CACHE_SCALE })),
  });
  return {
    snapped: snapped.map((p) => ({ x: p.x / VECTOR_CACHE_SCALE, y: p.y / VECTOR_CACHE_SCALE })),
  };
}
