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

export async function snapToVector(
  env: Env,
  args: { project_id: string; page_index: number; points: Point[]; tolerance_px?: number }
): Promise<{ snapped: Point[] }> {
  const page = await getPage(env.DB, args.project_id, args.page_index);
  if (!page?.vector_cache_json) {
    return { snapped: args.points };
  }
  const cache = JSON.parse(page.vector_cache_json) as VectorCache;
  const tol = args.tolerance_px ?? 8;
  const snapped = args.points.map((p) => snapOne(p, cache, tol));
  return { snapped };
}
