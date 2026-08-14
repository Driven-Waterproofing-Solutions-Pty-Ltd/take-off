---
name: waterproofing-takeoff
description: >-
  Performs waterproofing quantity takeoffs from builder plan PDFs for Driven
  Waterproofing Solutions, and prices them. Use whenever the user asks to "do a
  takeoff", "measure these plans", "quote this job", or hands over builder plans
  (Leading Edge, Hallmark, AHC, Hastie, etc.). Covers locating/rasterising the
  plans, identifying wet areas and substrate (slab vs suspended timber),
  measuring floors and shower walls off the dimensioned sheets, counting fillets
  and junctions by the photo-calibrated rule, applying Driven's rate cards, and
  producing a priced quote with a GP check. Hard rule: every measurement comes
  from the actual rasterised plan — never estimate, guess, or invent scope.
---

# Driven Waterproofing — Plan Takeoff

You are doing a waterproofing quantity takeoff the way Andy at Driven does it: open
the real plan, look at every sheet, measure the wet areas off the dimensions printed
on the page, and price it with Driven's rates. The output is a quote a tradesman can
stand behind on site.

## The one rule that overrides everything

**Never fabricate a measurement, a room, a quantity, or a number you did not read off
the actual plan.** If you cannot see the rasterised sheet, you cannot do the takeoff —
say so and stop. A made-up area becomes a real loss on a real job. This is the single
most important behaviour in this skill. Past failures came from "downloading" a plan
that never landed and then inventing scope from a room schedule; do not do that. No
plan in front of you → no measurement out.

Corollaries:
- **Do not trust room/door schedules or text extraction to define scope.** They
  over-count: they list every tiled robe, hall and WIR as if it needs membrane.
  Measure the wet areas you can actually see and justify on the floor plan.
- If a sheet is missing, illegible, or the wrong job (e.g. a chase email sent the
  wrong lot's plans), flag it and ask for the correct sheet rather than guessing.

## Workflow

### 1. Get the plans in front of you
- If the user attaches/uploads a PDF, use it directly.
- If the plans live in Driven's M365 / SharePoint, retrieve them — see
  `reference/plan-retrieval.md`. Leading Edge plans live under
  `01_BUILDERS/Leading_Edge/`. Download the actual file bytes to disk; do not
  work from a metadata listing.
- Confirm the lot/job/builder before measuring. Wrong-plan mix-ups have happened.

### 2. Rasterise every sheet
- `pdftoppm -r 200 plan.pdf page` (200 DPI is the floor for reading dimensions).
- Read **every** page image. The wet areas, the dimensions, the floor build-up
  notes (slab vs timber), and the WC/shower locations are spread across the
  architectural set, not on one sheet.
- Never rely on the PDF text layer for geometry or scope — measure off the raster.

### 3. Identify wet areas and substrate
- Walk every sheet and list the actual wet areas: bathrooms, ensuites, powder rooms,
  laundries, WCs, balconies/decks, planters. Tiled-only robes/halls are **not**
  automatically waterproofed — include only what genuinely gets membrane.
- Establish substrate per area, because it changes the method and the fillet/joint
  counting:
  - **Ground floor = concrete slab** (no sheet joints to tape).
  - **Upper floor = suspended timber / sheet (Scyon/CFC/yellowtongue)** — sheet
    joints get taped, and horizontal joint lines on the plan count (see counting rule).

### 4. Measure off the dimensioned sheet
- Read room dimensions directly off the figured dimensions on the floor plan.
  Prefer the dimensioned floor plan over scaling where figures exist.
- Floor area per wet area = the membraned floor footprint (m²).
- Shower walls = wall length × waterproofed height (m²) — standard shower wall
  waterproofing height unless the spec says otherwise.
- Perimeter / flashing-only rooms (a wet area that gets edge flashing but no full
  floor membrane) are measured in lineal metres, not m².
- Capture: shelves/niches (each), wastes (each, by finish), angles/hobs, and any
  balcony/planter membrane separately — these are their own rate lines.

### 5. Count fillets and junctions — the photo-calibrated rule
This is where takeoffs are usually wrong. See `reference/counting-and-method.md` for
the full rule. Summary:
- **Wall-to-floor junctions:** count everywhere membrane goes — the full internal
  perimeter of each wet area floor gets a fillet.
- **Vertical lines on the plan:** count a corner fillet **only at a change of plane**
  (an actual internal corner). Do not count nail-head runs or stud lines on a flat
  wall as corners.
- **Horizontal lines:** these are sheet joints → tape them, and count them **only on
  suspended-timber floors**, never on a slab.
- Apply **+10% wastage** to every membrane/fillet/tape quantity off the TDS coverage
  rate.

### 6. Price it
Use the **current simplified estimator rate card** (all-in installed rates, lineal and
labour baked into the meterage). Full numbers and provenance in
`reference/rate-cards.md`:
- Floor (any substrate, lineal baked in): **$172.85/m²**
- Shower walls: **$55/m²**
- Perimeter-only flashing (rooms with no full floor): **$28/lin m**
- Shelves: **~$30–40/lm**
- Niches: **$70 each**
- Wastes: **$55 each** (stainless "smart" = good margin; gold/black → bump up)
- "Lay-for-gold" single angle rate: **OPEN — confirm the number with Andy before
  using it.** Do not invent it.

**Builder ≠ Leading Edge?** The simplified card is LE-specific. For DJ Roberts
(DJR), Hallmark, Hastie, AHC and others, the card doesn't apply — get the
builder's rate sheet first, or price on the legacy granular card with a clear
"builder rate pending" flag. Don't silently default to LE rates on a non-LE plan.

### 6a. Check the colour / PC item selections separately
Architectural plans don't carry **floor waste finishes** (chrome / brushed gold /
matte black / Plastec Smart). Those come from the **builder's PC item list or
colour selections sheet**, which is a separate file. Quote at the default
$55/ea (chrome / standard stainless) unless the colour selections are in hand;
flag the line for confirmation. Per cost-data-memo §4, Plastec Smart bills at
$65/ea cost-side; gold/black wastes bill higher again. Same caveat applies to
**angles** (Streamline gunmetal / bright gold) and **tapware finishes**.

Material cost side (for GP%, "what to buy") lives in
`take-off-web/dispatches/cost-data-memo.md` — the GCP Silcor system at real Tilers
Warehouse buy prices, with TDS coverage rates and cost recipes per assembly.

### 7. Labour + margin check
- Loaded labour cost: **$95/hr tradesman, $60/hr offsider** (cost, not charge-out).
- Typical Leading Edge job: **~2 days solo**, **3 days** for a big one.
- **No multi-level / restricted-access loading for Leading Edge** — the margin is
  already baked into the per-m² rate. (Other builders / genuinely restricted jobs:
  cost the real crew time; see the 3-Unit reference in the cost memo.)
- **40% gross-profit floor.** If the priced quote falls below 40% GP against the
  material+labour cost, flag it — don't quietly ship a thin job.

### 8. Sanity-check against known jobs
A typical Leading Edge home lands **~$6,600–$7,800**. Calibration anchors (see
`reference/worked-examples.md`): Glen Retreat ~$6,620 (44% GP), Kinnen ~$6,691
(2 days, 46% GP), Varcoe ~$7,008, Redwood ~$7,142, White ~$7,247 (48% GP), Nellie
~$7,791 (3 days). If your number is well outside that band for a comparable house,
re-check the wet-area count and the floor areas before presenting it.

### 9. Present the takeoff
Show: wet-area list with substrate, floor m² per area, shower-wall m², fillet/junction
counts, the priced line items, the total, and the GP%. State what you measured off
which sheet so it's auditable. Then stop for human review — **never** push anything to
Xero from this skill; quoting/pushing is a separate, human-gated step (DRAFT only).

## The product system (what these numbers assume)
GCP Silcor: BS Primer → Silcor 560 HB charcoal on floors (single thick high-build
coat) / Silcor 140 on walls (field-diluted ~50/50 with water as the primer coat);
SAS PU25 12 mm fillet at every internal corner and change of plane; butyl tape at
shelf joints; +10% on all TDS quantities. Detail and TDS coverage in
`reference/counting-and-method.md` and the cost memo.

## When the deployed app is involved
The web app (`take-off-web/`) has the measuring engine and MCP tools. This skill is
the *methodology* — it tells you what to measure and how to price it. When the app is
live and keyed, the same rules drive its agent (`build_quote` stops for human review;
`push_to_xero` stays DRAFT-only and human-gated). See
`take-off-web/dispatches/takeoff-agent-design.md`.
