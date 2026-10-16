# Bug 5 — INSERT OR IGNORE silently swallows newer retry payload

## VERDICT
**Confirmed.** The full chain Codex describes is real. The `INSERT OR IGNORE` discards any retry that arrives with a mutated payload (different `item_id`, `points`, `value`, `deduction`, `text`), but the client unconditionally snapshots the **latest local state** as "synced" once the POST resolves 2xx. The server row therefore holds the FIRST commit's payload forever; subsequent diff cycles see snapshot==local and never repair it. The corruption silently survives until reload.

## EVIDENCE

### 1. The `INSERT OR IGNORE` itself
`/home/user/take-off/take-off-web/apps/worker/src/db/queries.ts` lines 134–163:
```ts
export async function insertShape(db, shape) {
  // ...comment explicitly documents this as idempotency for useShapeSync retries...
  await db.prepare(
    `INSERT OR IGNORE INTO shapes (id, item_id, page_index, points_json, bulges_json, value, deduction, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(shape.id, shape.itemId, shape.pageIndex, JSON.stringify(shape.points), ...).run();
}
```
There is no follow-up SELECT to check whether the existing row matches what the caller sent, and no return value. The worker route (`measure.ts:addArea`/`addLinear`/etc.) then calls `recalcItemTotal` and returns `shape` — the payload the **client sent**, NOT the row that's actually in D1. So the response body misleadingly echoes the new payload even when the DB still has the old one.

### 2. `useShapeSync` retry path
`/home/user/take-off/take-off-web/apps/web/src/hooks/useShapeSync.ts` lines 248–340:
```ts
for (const [shapeId, { item, shape }] of nextShapes) {
  if (inflight.current.has(`shape:${shapeId}`)) continue;
  const prev = shapeSnapshots.current.get(shapeId);
  const nextSnap = snapshotShape(item, shape);
  if (!prev) {
    // ...inflight.set + dispatch POST with CURRENT shape.points / item.id...
    promise.then(() => shapeSnapshots.current.set(shapeId, nextSnap))
           .catch((e) => console.error('sync: create shape failed', shapeId, e))
           .finally(() => { inflight.current.delete(...); retry(); });
  }
```
On `.catch` the snapshot is **not** set (intentional — see comment lines 164–166 of the hook). So next tick `prev` is still undefined and the same branch runs again — but this time `shape` is whatever the latest React state holds. If the user edited the polygon or did "Change Item" between the original POST and the retry, the new POST carries the new `points`/`item_id` with the same `shape_id`.

### 3. The post-success snapshot, taken from the LATEST local state
Same file, line 335:
```ts
promise.then(() => shapeSnapshots.current.set(shapeId, nextSnap))
```
`nextSnap` was built at line 251 from the current `shape` object — which on a retry contains the *newer* `points`/`value`/`itemId`. The hook treats any 2xx as proof that those newer values are now on the server. There is no check that the response body actually reflects what was sent.

### 4. The diff loop never reissues a write
Same file, lines 341–366:
```ts
} else if (
  prev.itemId !== nextSnap.itemId ||
  prev.pointsHash !== nextSnap.pointsHash ||
  prev.deduction !== nextSnap.deduction ||
  prev.value !== nextSnap.value ||
  prev.text !== nextSnap.text
) {
  // PUT /shapes/:id
```
After the bogus snapshot, `prev` equals current local state, so no field drifts → no PUT is ever issued. The server row stays stuck on the original payload until a future edit drifts the local state again. On reload, `useProjectManagerWeb` pulls items from the server (`api.items.list`) and the user sees the shape jump back to its pre-edit position / pre-reparent item.

## BLAST RADIUS

The "first commit, lost response" scenario is uncommon but not exotic on a CF Workers + browser combo:

- **Network drop mid-response** — flaky wifi, mobile handoff, VPN reconnect after the worker has already returned `c.json(...)` but before the body lands. Most likely trigger in the field.
- **CF edge timeouts** — the body-stream connection can be cut after the worker finishes (rare; CF allows up to ~30s response streaming, well past D1 write times).
- **Browser tab throttling / sleep** — backgrounded tabs can have fetches aborted; the worker request still completes.
- **User reload at the wrong instant** — `fetch` is cancelled, but the D1 write commits.

To trigger the **silent corruption** you also need the user to interact with that shape (drag a vertex, Change Item, toggle deduction, edit NOTE text) BEFORE the hook retries. The hook's retry latency is whatever drives the next `items` change or the next `tick`, which is almost immediate (the failed POST's `.finally()` calls `retry()` synchronously). So the window is small — typically under a second — but it overlaps the exact period where the user is most likely to keep editing the just-drawn shape (e.g. drag a vertex right after drop).

So: rare in absolute terms, but the impact is silent data loss with no toast / no error path. The shape "looks fine" until reload, by which point the user may have built downstream estimates on the wrong measurement.

## ROOT CAUSE
`INSERT OR IGNORE` makes the create idempotent against the same payload but silently no-ops when the retry payload differs, while the hook treats every 2xx as authoritative proof that the local state is now on the server.

## FIX SKETCH

- Replace `INSERT OR IGNORE` with `INSERT ... ON CONFLICT(id) DO UPDATE SET item_id=excluded.item_id, points_json=excluded.points_json, bulges_json=excluded.bulges_json, value=excluded.value, deduction=excluded.deduction, text=excluded.text`. Same shape_id = same logical write, just carrying the freshest payload.
- After the upsert, run `recalcItemTotal` for **both** the old `item_id` (if it changed) and the new one — otherwise a reparent retry under-counts the source item. Read the prior row with `RETURNING item_id` (D1 supports `RETURNING`) or with a pre-SELECT inside the same statement batch.
- Alternative (more conservative): keep `INSERT OR IGNORE`, but after it runs, `SELECT * FROM shapes WHERE id=?`; if any non-id column differs from the request, return a 409 so the hook can flip into "update" mode. Less surgery on the worker, more on the hook.
- Add an integration test that simulates "POST 1 commits but client never sees the response, user mutates, POST 2 arrives" — assert the D1 row reflects POST 2.
- Defence-in-depth: have the worker return the actual D1 row (a follow-up SELECT) rather than echoing `args`. Then the hook can compare the returned row against `nextSnap` and re-queue a PUT if they disagree.

## TEST PLAN

1. **Unit:** in the worker harness, `insertShape({id:'s1', points:[A]})`, then `insertShape({id:'s1', points:[B]})`, then `SELECT points_json FROM shapes WHERE id='s1'` — expect `[B]` after fix; currently returns `[A]`.
2. **Integration via the hook:** monkey-patch `api.shapes.area` so the first call resolves only after the second resolves with newer points; assert final D1 row matches the second payload and local snapshot.
3. **E2E (Playwright):** intercept the first `POST /api/measure/shapes/area`, let the worker commit, but return a network error to the client; in the meantime drag a vertex; let the retry through. Reload the page and assert the polygon matches the post-drag geometry.
4. **Reparent variant:** same as (3) but do a Change Item instead of a vertex drag — verify both source and destination item totals are correct after reload.
