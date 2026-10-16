# Leading Edge takeoffs — batch run

End-to-end runs of the `waterproofing-takeoff` skill against the LE plans
retrievable from Drive at this point. One doc per job covers methodology,
sheet-by-sheet inspection, measurements (with the dimensions actually read off
the page), the priced quote on the LE simplified estimator card, and the GP
check.

## Completed

| Job | Status | Total inc GST | GP | Notes |
|---|---|---:|---:|---|
| 37 Allambie St, Carina | ✅ Done | $6,802 | 43.4 % | 5 wet areas, LE 2-storey, in-band |
| 76 Reuben St, Stafford | ⚠ Done — under GP floor | $6,131 | 38.5 % | 5 wet areas, smaller floor m² — flagged for rate review |

## Blocked

| Job | Blocker |
|---|---|
| Lot 29 Canonbar St, Stafford | Drive file 7.3 MB — exceeds connector per-response token cap. Single-shot base64 decode times out. **Fix:** any of (a) someone resaves the PDF to a slimmer file under ~5 MB, (b) splits it page-range for me, (c) we wire a streamed-download path on the MCP. |
| Nellie St Camp Hill | SharePoint-only — connector returns extracted text, not the file bytes. Found at `01_BUILDERS/Leading_Edge/02_PLANS_SPECS/2026-02-19_10 Nellie St Camp Hill_O.pdf` but unreachable in current session. |
| Risley | Blocked upstream (per cost memo): correct BA plans never sent by Leading Edge — Feb 2026 email carried wrong dwelling's plans. Chase email drafted to Harry Carter. |
| Kinnen / Varcoe / Redwood / White / Glen Retreat / Driver | Not located in Drive. Likely SharePoint-only same as Nellie. |
| Allambie / Leonard Cres / Douglas St / Tuckerman (outstanding LE backlog) | Allambie ✅ above; the other three not located in Drive. |

## Methodology — what every doc covers

1. **Retrieve** the PDF bytes from Drive (skill rule: never measure off a SharePoint
   text extract — get the actual file).
2. **Rasterise** at 75 DPI for sheet identification; 200–300 DPI on the
   wet-area-relevant sheets for dimension reading.
3. **Walk every sheet** visually — never trust the floor-coverings schedule for wet
   scope (over-counts tiled robes/halls).
4. **Confirm builder = Leading Edge** off the cover title block before applying the
   simplified estimator rate card.
5. **Establish substrate per floor** from the section sheet: GF = slab, L1 = 19 mm
   Structa floor on 400H joists for the Pavilion Studio LE template (suspended
   timber → sheet-joint tape on L1 wet rooms).
6. **Identify wet areas** off the Wet Area Details sheet (typically pg 13–14 in
   the Pavilion template) — Ensuite, Bathroom, WC, Powder, Laundry.
7. **Measure internal floor m²** off figured dimensions, using 70 mm wall inset
   per the dim strings on the wet-area details.
8. **Read shower bases** directly off the wet-area sheet (e.g. 1690 × 1160,
   2050 × 1000).
9. **Count fillets and junctions** per the photo-calibrated rule (full perimeter
   wall-to-floor fillet everywhere membrane goes; vertical fillets only at
   change-of-plane; horizontal sheet-joint tape on L1 timber floors only).
10. **Price** on the LE simplified estimator card (`reference/rate-cards.md` §1).
11. **GP check** against material cost recipes (`cost-data-memo.md` §6) plus
    3-day loaded labour at $95/hr for a 2-storey, ~2 days for single-storey.
12. **Sanity check** against the worked-examples band ($6.6–7.8k inc GST for LE
    2-storey).

## Standing caveats (apply to every doc unless otherwise noted)

- **Waste finishes NOT verified** — architectural plans don't carry waste colour;
  the colour / PC item selections list is a separate file. All quotes use the
  default $55/ea (chrome / standard stainless). Brushed gold / matte black
  selections bump per `cost-data-memo §4`. **Andy: if you have the LE colour
  selections per job, send them and I'll re-quote the affected lines.**
- **"Lay-for-gold" angle rate open** — not separately quoted on any of these.
- **Wall thickness assumed 70 mm internal partitions** — matches the figured
  bay strings on the Pavilion Studio wet-area sheets.
- **Pool waterproofing excluded** — out of Form 43 dwelling scope.

## Next runs

In rough order of likely value:

1. **Canonbar Lot 29** — known resolved LE job, would round out the LE
   calibration anchor set. Blocked on file size; resolve as above.
2. **Bevington Lot 52** in the same Drive folder (21 MB, builder unknown) —
   confirm builder before takeoff; if LE, also blocked on size.
3. **Nellie + remaining outstanding LE backlog** — requires either Drive copies
   or a Graph download path off SharePoint.
4. Cross-check Andy's outstanding-jobs list against actual Drive contents to
   close gaps.
