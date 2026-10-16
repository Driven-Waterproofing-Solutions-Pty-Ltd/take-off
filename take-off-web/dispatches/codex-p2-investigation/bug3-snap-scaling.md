# Bug 3 — MCP snap_to_vector coordinate scaling

**VERDICT:** confirmed

## EVIDENCE

### 1. MCP handler — no scaling around `snapToVector`
`/home/user/take-off/take-off-web/apps/worker/src/mcp/server.ts:51`

```ts
const handlers: Partial<Record<ToolName, Handler>> = {
  ...
  add_area: (env, i) => addArea(env, i as Parameters<typeof addArea>[1]),
  add_linear: (env, i) => addLinear(env, i as Parameters<typeof addLinear>[1]),
  ...
  snap_to_vector: (env, i) => snapToVector(env, i as Parameters<typeof snapToVector>[1]),
```

`add_area`/`add_linear` go through `maybeSnap` in `tools/measure.ts`, which does the 2x scaling. `snap_to_vector` calls `snapToVector` raw — no scaling.

### 2. The 2x scaling that `add_*` apply
`/home/user/take-off/take-off-web/apps/worker/src/tools/measure.ts:23-53`

```ts
// Vector cache is uploaded from the canvas in RENDER_SCALE x PDF-point space
// (see apps/web/src/utils/vectorExtractor.ts), but shapes round-trip through
// the REST/MCP surface in PDF-point space. Without this conversion the snap
// compares a point near PDF (100, 100) against cache geometry near (200, 200),
// so either no snap fires or it snaps to cache coords that then get stored as
// shape points = double-sized geometry. Mirrors the agentTools snap_to_vector
// executor — keep both in lockstep.
const VECTOR_CACHE_SCALE = 2;

async function maybeSnap(env, projectId, pageIndex, points, snap) {
  if (snap === false) return points;
  const scaled = points.map((p) => ({ x: p.x * VECTOR_CACHE_SCALE, y: p.y * VECTOR_CACHE_SCALE }));
  const { snapped } = await snapToVector(env, { project_id: projectId, page_index: pageIndex, points: scaled });
  return snapped.map((p) => ({ x: p.x / VECTOR_CACHE_SCALE, y: p.y / VECTOR_CACHE_SCALE }));
}
```

The browser executor for the AI agent does exactly the same thing:
`/home/user/take-off/take-off-web/apps/web/src/lib/agentTools.ts:253-276`

```ts
case 'snap_to_vector': {
  // Agent works in PDF-point space; vector cache lives in 2x space.
  const scaled = requested.map((p) => ({ x: p.x * VECTOR_CACHE_SCALE, y: p.y * VECTOR_CACHE_SCALE }));
  const out = await api.snap({ project_id: pid, page_index: Number(input.page_index), points: scaled, ... });
  return textResult(id, { ...out, snapped: out.snapped.map((p) => ({ x: p.x / VECTOR_CACHE_SCALE, y: p.y / VECTOR_CACHE_SCALE })) });
}
```

### 3. `snapToVector` signature — operates in cache space (2x content-pixel)
`/home/user/take-off/take-off-web/apps/worker/src/tools/snap.ts:52-71`

```ts
export async function snapToVector(
  env: Env,
  args: { project_id: string; page_index: number; points: Point[]; tolerance_px?: number }
): Promise<{ snapped: Point[] }> {
  const page = await getPage(env.DB, args.project_id, args.page_index);
  if (!page?.vector_cache_json) return { snapped: args.points };
  ...
  const tol = args.tolerance_px ?? 8;
  const snapped = args.points.map((p) => snapOne(p, cache, tol));
  return { snapped };
}
```

Vector cache is built in `vectorExtractor.ts` with `RENDER_SCALE = 2.0` (confirmed in `BlueprintCanvas.tsx:87`), so `snapToVector` expects 2x content-pixel space; tolerance default `8` is in that same space.

## BLAST RADIUS

- **MCP `snap_to_vector`**: Exposed in `MCP_TOOLS` array (server.ts:32), so any MCP client (e.g. Copilot Studio per `dispatches/copilot-studio-*.md`) calling it gets broken behaviour. Inside the codebase the only programmatic callers wrap their own scaling — the MCP path is the orphan. No tests exercise the MCP handler directly.
- **REST `/api/measure/snap`** (`measurements.ts:66-70`): same bug — handler calls `snapToVector` raw. In-tree the only caller is `api.snap`, used **only** by the browser AI agent executor in `agentTools.ts`, which scales before/after. So the REST endpoint is safe today **only** because its sole consumer happens to compensate; any new direct caller would hit the same bug.
- Severity: medium. Real exposure depends on whether an external MCP client is wired up. The MCP tool is advertised via `tools/list`, so the contract is public-facing.

## ROOT CAUSE

`snapToVector` operates in 2x content-pixel space (vector cache space), but the MCP handler — unlike `add_area`/`add_linear`/`agentTools` — forwards caller-supplied PDF-point coordinates straight through, so the snap either silently misses (tolerance 8 in 2x space vs PDF coords offset by ~2x) or returns cache-space coordinates the client may store as oversized geometry.

## FIX SKETCH

- Lift `maybeSnap`'s scale-wrap from `tools/measure.ts` into a small helper, e.g. `snapInPdfPoints(env, args)`, that takes PDF-point coords and returns PDF-point coords.
- Have the MCP `snap_to_vector` handler call that helper instead of `snapToVector` directly (`server.ts:51`).
- Have the REST `/api/measure/snap` handler do the same (`measurements.ts:66-70`).
- Update `maybeSnap` to use the new helper to keep one definition of the scale boundary.
- Keep `snapToVector` itself unchanged (the cache-space contract is internally consistent and reused).
- Optionally: drop the now-redundant scale-wrap in `agentTools.ts:253-276` and let the REST endpoint do it — single source of truth.

## TEST PLAN

1. Unit: load a fixture page with `vector_cache_json` containing a vertex at cache coord (200, 200). Call the MCP handler with `points: [{x:101, y:101}]`. Expect `{snapped: [{x:100, y:100}]}` (PDF-point space, snapped). Currently returns `{x:101, y:101}` unchanged (tolerance 8 vs distance ~140 in cache space — silent miss).
2. Unit for REST: same fixture, POST `/api/measure/snap` with `{points:[{x:101,y:101}]}` — same expectation.
3. Regression: `add_area` flow with `snap: true` still produces correctly sized polygons (existing behaviour must not regress; helper extraction is the risk).
4. End-to-end: run a Copilot-Studio-style MCP call sequence (`snap_to_vector` then `add_area` with the snapped points) and confirm the saved shape's `value` matches a known wet-area size.
