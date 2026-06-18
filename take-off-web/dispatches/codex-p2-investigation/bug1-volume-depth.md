# Codex P2 — Volume template `depth` not unit-rebased

## VERDICT: confirmed

The file exists at `/home/user/take-off/take-off-web/apps/web/src/components/NewItemModal.tsx`. The bug is real and Codex's diagnosis is correct, including the ~3.28× magnitude.

## EVIDENCE

1. Template carries a depth in its OWN linear unit (saved at template creation):

   `take-off-web/apps/web/src/types.ts:140-141`
   ```ts
   /** For VOLUME templates: depth in the page's linear unit (matches Item.depth). */
   depth?: number;
   ```
   And `take-off-web/apps/web/src/components/PropertiesModal.tsx:456-458` saves `depth: item.depth` straight from the source item, whose depth was entered in *that* item's page linear unit.

2. The modal rebases `unit` to the destination page's linear family but copies depth raw:

   `take-off-web/apps/web/src/components/NewItemModal.tsx:185-205`
   ```ts
   } else if (toolType === ToolType.VOLUME) {
       rebasedUnit = getVolumeUnitFromLinear(pageLinearUnit);   // e.g. cu_ft -> cu_m
   } ...
   onCreate({
       ...
       unit: rebasedUnit,
       ...
       depth: template.depth,   // <-- raw, no convertLinearUnit
   });
   ```
   `convertLinearUnit` is exported right next to `getVolumeUnitFromLinear` in `take-off-web/apps/web/src/utils/geometry.ts:238`, so the helper is in scope.

3. Downstream the depth is multiplied into the final cubic quantity. Server-side hydration:

   `take-off-web/apps/worker/src/db/queries.ts:268-275`
   ```ts
   const depth = row.depth ?? undefined;
   const totalValue =
       type === ToolType.VOLUME && depth != null ? row.total_value * depth : row.total_value;
   ```
   `row.total_value` is the polygon area in `linear_unit²` (sq m on a metric page). Multiplying by an unconverted `depth = 1` from a `cu_ft` template gives `area_m² × 1`, labelled `cu m` — overstating by `1 / 0.3048 ≈ 3.28×`.

4. The codebase already documents this exact magnitude in the recalibration path — the analogous fix was applied there but **not** to the template-drop path:

   `take-off-web/apps/worker/src/tools/scale.ts:180-191`
   ```ts
   // VOLUME items carry a depth in the page's linear unit. ... a 1 ft depth
   // becomes 0.3048 m on a ft→m switch — without the same conversion here,
   // a server/MCP recalibration kept the raw "1" and overstated the cubic
   // quantity by ~3.28×.
   const nextDepth = convertLinearUnit(row.depth, prevUnit, scale.unit);
   ```

## BLAST RADIUS

- Trigger: user has saved a VOLUME template on one page/project (any linear unit), then opens NewItemModal on a calibrated page whose linear unit differs and picks the template from the "From Template" tab.
- Symptom: the cubic total stored on the item, displayed in legends, used by `buildQuote` (`apps/worker/src/tools/memory.ts:283-289` → `qty * item.price`) and 3D extrusion (`ThreeDView.tsx` reads `depth`) is wrong by the depth-unit ratio. Common cases:
  - ft template on metric page: ~3.28× too high (cu m labelled with depth still in "ft")
  - m template on ft page: ~0.30× too low
  - mm template on m page: ~0.001× too low (catastrophic underbill)
  - in template on ft page: ~12× too high
- Visibility: it's a *plausible-looking number* — not a NaN, not a unit label mismatch (label was rebased correctly). Quote $ amount is directly wrong with no warning signal.
- Likelihood: Driven Waterproofing Solutions runs metric (mm/m). All saved templates will be metric. Cross-unit drops happen only when a user pulls in a template from a project that was calibrated in a different unit — relatively low in steady state, but a real silent bug whenever it does fire. Estimate: **low-to-medium** frequency, **high** $-impact when it fires.

## ROOT CAUSE

`NewItemModal.tsx`'s template→item handler rebases the unit label via `getVolumeUnitFromLinear(pageLinearUnit)` but never converts the numeric `depth` from the template's saved linear base into the destination page's linear unit.

## FIX SKETCH

- In `NewItemModal.tsx` around line 205, derive the template's original linear base from `template.unit` (e.g., `cu ft` → `ft`). The `getLinearBase` helper in `@takeoff/shared` already does this and is used elsewhere (`apps/worker/src/db/queries.ts:218`).
- When `toolType === ToolType.VOLUME && template.depth != null && rebasedUnit !== template.unit`, convert: `depth = convertLinearUnit(template.depth, templateLinear, pageLinearUnit)`.
- Skip conversion when `pageLinearUnit` is unset (keep current behaviour — no calibration, no rebase).
- Pull `convertLinearUnit` and `getLinearBase` from the same import path the modal already uses (`../utils/geometry` re-exports them via `@takeoff/shared`).
- Add a comment cross-referencing `scale.ts:180-191` so future readers see both rebase paths share the same invariant.

## TEST PLAN

- Unit test the handler: given `template = { type: VOLUME, unit: 'cu ft', depth: 1 }` and `scaleUnit = m`, assert the dispatched `onCreate` payload has `unit = 'cu m'` AND `depth ≈ 0.3048`.
- Symmetric case: `unit: 'cu m', depth: 0.1` dropped on a ft page → `depth ≈ 0.328 ft`.
- No-op case: template `cu ft` dropped on ft page → depth unchanged.
- No-calibration case: `scaleUnit` undefined → depth unchanged, unit unchanged.
- Integration: save a real volume template on a metric project, open a feet-calibrated page, drop the template, draw a known polygon, confirm `totalValue` matches hand calc `area_ft² × depth_ft` (not `area_ft² × depth_m`).
- Regression: run the existing `scale.ts` recalibration-depth tests to confirm both paths now share consistent behaviour.
