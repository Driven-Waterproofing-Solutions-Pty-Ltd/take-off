# Bug 6 — Assembly unit-family validation on attach

## VERDICT: confirmed

`applyAssembly` validates only the existence of the assembly row; `buildQuote` ignores `assemblies.unit` entirely and multiplies the assembly formula (or fallback `item.totalValue`) by each line's `qty_per_unit` regardless of whether the item's unit is in the same dimensional family as the assembly's unit. An agent (or operator) can attach a `sq m` Driven floor-membrane assembly to a `lin m` perimeter item and the quote will silently price it against a length, producing a much smaller total than the correct area-based one — with no warning anywhere in the system.

## EVIDENCE

### 1. Attach path — existence-only check (`memory.ts:179-205`)

```ts
export async function applyAssembly(
  env: Env,
  args: { project_id: string; item_id: string; assembly_id: string }
): Promise<TakeoffItem> {
  const exists = await env.DB.prepare('SELECT 1 FROM assemblies WHERE id = ?')
    .bind(args.assembly_id).first();
  if (!exists) throw new Error(`Assembly ${args.assembly_id} not found`);

  const res = await env.DB.prepare(
    'UPDATE items SET assembly_id = ?, updated_at = ? WHERE id = ? AND project_id = ?'
  ).bind(args.assembly_id, Date.now(), args.item_id, args.project_id).run();
```

No read of the item row, no comparison of `items.unit` vs `assemblies.unit`.

### 2. Schemas — both sides carry a `unit` column (`migrations/0001_init.sql:33-52, 114-130`)

```sql
CREATE TABLE IF NOT EXISTS items (
  ...
  unit            TEXT NOT NULL,
  ...
  assembly_id     TEXT,
);

CREATE TABLE IF NOT EXISTS assemblies (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  unit      TEXT NOT NULL,   -- e.g. 'sq m', 'lin m', 'EA'
  formula   TEXT,
  ...
);
```

`Unit` enum (`packages/shared/src/types.ts:15-55`) is dimensional: linear (`m`, `ft`, `lin m`), area (`sq m`, `sq ft`, `hectares`), volume (`cu m`, `L`), count (`EA`, `Pcs`). The same families are codified for shapes/items by `itemFamily()` + `getLinearBase()` and enforced at `getOrCreateItem` (`queries.ts:208-222`) and shape reparent (`tools/items.ts:228-246`) — i.e., this codebase already has the policy machinery; it just isn't wired into assembly attach.

### 3. `buildQuote` assembly branch — `assemblies.unit` never read (`memory.ts:224-278`)

```ts
const assembly = (await env.DB.prepare(
  'SELECT id, name, unit, formula FROM assemblies WHERE id = ?'
).bind(item.assemblyId).first()) as { ... unit: string; formula: string | null } | null;

const qty = evaluateFormula(item, item.totalValue, assembly?.formula ?? undefined);

for (const r of linesRes.results) {
  const totalQty = qty * r.qty_per_unit * (1 + r.waste_pct / 100);
  lines.push({ ... qty: totalQty, unit: r.material_unit, ... });
}
```

`assembly.unit` is selected but never referenced. `evaluateFormula(item, item.totalValue, formula)` (`packages/shared/src/math.ts:91-99`) returns `qty` straight from the item's raw scalar — there is no unit conversion, family check, or even a console warning.

### 4. Items hydration — item carries `unit` already (`db/queries.ts:266-283`)

```ts
return { id: row.id, label: row.label, type, color: row.color,
         unit: row.unit as Unit, shapes, totalValue, ... };
```

So both sides of the comparison are trivially available at attach time (one extra `SELECT unit FROM items WHERE id = ?`).

## BLAST RADIUS

- **Frequency:** assembly attach is exposed both via REST (`/apply-assembly`), MCP (`server.ts:37`), and the AI tool list (`ai.ts:51`). The agent's documented Driven workflow attaches one `sq m` floor-membrane assembly per wet-area item, plus a `lin m` flashing assembly per perimeter item — i.e. dozens of attaches per quote.
- **Real-world miss rate:** in practice agents pick assemblies by name/tag (`list_assemblies({tag: 'floor'})`) and assemble units usually do align with item units, so the bug rarely fires on hand-curated takeoffs. But:
  - Builders' wet areas sometimes get measured as LINEAR (perimeter-only flashing scope) and a careless agent picking `floor-membrane` (sq m) attaches against a `lin m` item — quote understates by ~item_perimeter / item_area.
  - A `count`-typed item (EA shower screens) with a `sq m` membrane assembly silently multiplies a count by m²/unit consumption — wrong by orders of magnitude.
  - Future agent flows that auto-suggest assemblies (no human in the loop) make this much more likely.
- **Silent failure:** no log, no validation error, just a quote line with the wrong qty. GP check (`takeoff_knowledge.sql:160`) is a fuzzy backstop but only catches ±15% deviations on Leading Edge jobs.

## ROOT CAUSE

`applyAssembly` checks the assembly row exists but never compares `items.unit`'s dimensional family / linear base against `assemblies.unit` — the same family check `getOrCreateItem` / `updateShape` already enforce for shapes, just not for assembly attach.

## FIX SKETCH

- Add an `items.unit` + `assemblies.unit` SELECT to `applyAssembly` before the UPDATE.
- Reuse `getLinearBase()` from `@takeoff/shared` and an `assemblyFamily(unit)` helper (area for `sq *`/`hectares`/`acres`, linear for bare linear, volume for `cu *`/`L`/`mL`, count for `EA`/`Pcs`/`Sheets`/etc.). The mapping already lives in the `Unit` enum — just bucket it.
- Reject when families differ; reject when families match but linear bases differ (e.g. `sq m` assembly on a `sq ft` item) — mirror the message style at `queries.ts:208-220`.
- Permit family-compatible mismatches only (AREA ↔ VOLUME both have a `m` linear base, like shapes) since `buildQuote` folds depth into `totalValue` in `rowToTakeoffItem`.
- Don't attempt full unit conversion here — Driven's rate cards are calibrated per unit, mixing m / ft on one project is a misconfig, not a normal flow.

## TEST PLAN

1. Unit test in `apps/worker/src/tools/memory.test.ts`:
   - attach `sq m` assembly to `lin m` item → throws with family-mismatch message.
   - attach `sq m` assembly to `sq ft` item → throws with linear-base message.
   - attach `sq m` assembly to `sq m` item → succeeds.
   - attach `sq m` assembly to `cu m` item → succeeds (AREA ↔ VOLUME, same linear base — matches shape policy).
   - attach `EA` assembly to `Pcs` count item → policy call (both count-family; same rule as items).
2. Integration: seed a project with a `lin m` perimeter item and a `sq m` floor-membrane assembly; assert the REST `/apply-assembly` returns 400.
3. Regression: existing snapshot quotes against the seeded Driven assemblies should be unchanged.

## CROSS-REF BUG 4

Bug 4 (assembly attach path concurrency / overwrite) touches the same `applyAssembly` UPDATE. Both fixes touch the same 5-line block; land them together so we don't churn the function twice and the new SELECTs can share one round-trip.
