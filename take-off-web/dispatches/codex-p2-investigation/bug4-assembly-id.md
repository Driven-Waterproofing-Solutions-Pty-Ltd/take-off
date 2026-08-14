# Bug #4 — Assembly ID validation missing on raw item update path

## VERDICT: confirmed

The raw REST `PUT /items/:id` path (which lands in `updateItem` at
`take-off-web/apps/worker/src/tools/items.ts:101`) accepts an `assembly_id`
field and writes it to the row with no existence check. `buildQuote` then
takes the assembly branch for the item, finds zero `assembly_lines`,
skips the price/sub-items fallback, and the item disappears from the
draft quote silently. `applyAssembly` already documents this exact failure
mode and validates the id, so the mirror-validation Codex is asking for
is missing.

## EVIDENCE

### 1. Raw update path stamps `assembly_id` without checking
`take-off-web/apps/worker/src/tools/items.ts:133`

```ts
if (patch.assembly_id !== undefined) { sets.push('assembly_id = ?'); binds.push(patch.assembly_id); }
```

No `SELECT 1 FROM assemblies WHERE id = ?` is run before the UPDATE. The
SQL has no FK constraint here (or the writer is bypassing it) — the
column is set verbatim.

### 2. `applyAssembly` DOES validate
`take-off-web/apps/worker/src/tools/memory.ts:179-190`

```ts
// Validate the assembly exists before attaching it. Without this check, a
// typoed or deleted assembly_id would silently land on the item, and
// buildQuote would skip it (no material lines, no priced-item fallback),
// making the item disappear from generated quotes.
const exists = await env.DB.prepare('SELECT 1 FROM assemblies WHERE id = ?')
  .bind(args.assembly_id)
  .first();
if (!exists) throw new Error(`Assembly ${args.assembly_id} not found`);
```

The comment confirms the bug mechanism Codex described, in the
maintainers' own words.

### 3. `buildQuote` silently drops the item
`take-off-web/apps/worker/src/tools/memory.ts:224-292`

```ts
for (const item of items) {
  if (item.assemblyId) {
    const assembly = (await env.DB.prepare(...).bind(item.assemblyId).first()) as ...;
    const linesRes = await env.DB.prepare(
      `SELECT ... FROM assembly_lines al JOIN materials m ... WHERE al.assembly_id = ?`
    ).bind(item.assemblyId).all();
    // ... iterates linesRes.results — empty for a bad id, so 0 lines emitted
  } else if (item.price) { /* price fallback */ }
  // sub-items branch is gated by `!item.assemblyId || !item.price`
  const parentEmitsLines = !!item.assemblyId || !!item.price;
  if (!parentEmitsLines && item.subItems && item.subItems.length > 0) { ... }
}
```

Crucial: `parentEmitsLines = !!item.assemblyId || !!item.price` is true
whenever the id is set — even if it points to nothing. So the
assembly branch produces zero lines AND the sub-items branch is
suppressed AND the price branch was already gated out by the `else`.
The item contributes nothing to the quote and there is no warning,
log, or error.

## BLAST RADIUS

- `updateItem` is exposed at `PUT /items/:id` (`routes/measurements.ts:81-84`)
  — authenticated REST. It's also the path the web client uses for ordinary
  item edits (`apps/web/src/lib/api.ts` → `api.items.update`) and useShapeSync
  syncs (`hooks/useShapeSync.ts:109,182` send `assembly_id` on every sync).
- `applyAssembly` is exposed at `POST /api/memory/apply-assembly` and as the
  MCP tool `apply_assembly`. The web client comment at `api.ts:318-327`
  explicitly warns: *"The agent must NOT route this through
  api.items.update({ assembly_id }), which writes the id raw and makes the
  item silently disappear from buildQuote if the assembly was stale or
  hallucinated."*
- Today's risk: the UI/agent is *supposed* to use `applyAssembly`, but
  (a) useShapeSync round-trips `assembly_id` through `createItem`/`updateItem`
  on every sync — if a row's `assembly_id` is ever stale (assembly deleted)
  the sync would happily re-stamp it without re-validating. (b) The MCP
  agent or any third-party REST consumer could hit `PUT /items/:id` directly.
  (c) `createItem` (items.ts:90) has the same gap on initial insert.

## ROOT CAUSE

`updateItem` (and `createItem`) accept `assembly_id` as an opaque string
and write it straight to the row, while the dedicated `applyAssembly`
helper that *is* the documented entry point performs the existence check —
so the validation is bypassed whenever a caller takes the raw item-write
path instead.

## FIX SKETCH

- In `updateItem`, when `patch.assembly_id !== undefined && patch.assembly_id !== null`,
  run the same `SELECT 1 FROM assemblies WHERE id = ?` check and throw
  `Assembly ${id} not found` if missing. Allow explicit `null` to clear.
- Mirror the check in `createItem` for `args.assembly_id` (same silent-drop
  risk on insert).
- Optional defence-in-depth: add a FK constraint
  `assembly_id REFERENCES assemblies(id) ON DELETE SET NULL` so deleting
  an assembly doesn't leave dangling refs that re-trigger this bug.
- Consider extracting the validation into a single helper used by
  `createItem`, `updateItem`, and `applyAssembly` to keep the rule in
  one place.
- In `buildQuote`, when `item.assemblyId` resolves to no assembly row,
  fall back to the price/sub-items branch (or at minimum log a warning)
  so the item never silently vanishes, even if a stale id slips through.

## TEST PLAN

1. Integration test: create a project + item, call
   `PUT /items/:id` with `{ assembly_id: 'does-not-exist' }`. Expect 400/500
   "Assembly not found" rather than a 200 with the bogus id persisted.
2. Regression test for `buildQuote`: insert an item with a bogus
   `assembly_id` directly into the DB (bypassing the new validation),
   call `buildQuote`, and assert either (a) it falls back to price/sub-items,
   or (b) it throws/warns — never silently emits zero lines for that item.
3. Verify `applyAssembly` test still passes (existing behaviour).
4. UI smoke: delete an assembly that's referenced by an item, open the
   project, generate a quote, confirm the item still shows up (or the
   user gets a clear error).
