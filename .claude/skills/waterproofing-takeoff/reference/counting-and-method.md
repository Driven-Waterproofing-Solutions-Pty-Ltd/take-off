# Counting & method — the photo-calibrated rule

The hardest part of a waterproofing takeoff is counting fillets and junctions
correctly, because a plan is covered in lines and only some of them mean "membrane
turns a corner here". This rule was calibrated against real site photos of finished
membrane work, so the count on paper matches what actually gets installed.

## What gets a fillet / junction

A 12 mm SAS PU25 fillet goes at **every internal corner and every change of plane**
that the membrane crosses. Translate that to the plan as follows:

### Wall-to-floor junctions — count everywhere membrane goes
Every wet-area floor that gets membrane gets a fillet around its **entire internal
perimeter** (wall meets floor). Measure the perimeter of the membraned floor; that
length is your wall-to-floor fillet run. This is the bulk of the fillet quantity.

### Vertical lines on the plan — count ONLY at a change of plane
A vertical line on the floor plan is a corner fillet **only when it's an actual
internal corner / change of plane** (the wall turns). Do **not** count:
- nail-head runs, stud lines, or batten lines drawn on a flat wall,
- door openings (no corner there),
- lines that are just hatching or dimension witness lines.
If the wall is flat, there is no vertical fillet there no matter how many lines are
drawn on it.

### Horizontal lines on the plan — sheet joints, suspended floors only
A horizontal line across a floor is usually a **sheet joint** (the edge of a
Scyon/CFC/yellowtongue sheet). Those joints get **butyl tape**, and you count them —
**but only on suspended-timber upper floors**. On a **ground-floor concrete slab there
are no sheet joints**, so horizontal lines there are not taped and not counted.

This is why establishing substrate (step 3 of the workflow) matters before you count:
the same drawing convention means "tape this" on L1 and "ignore this" on GF.

## Wastage
Apply **+10%** to every membrane, fillet and tape quantity derived from a TDS coverage
rate, to cover cut-offs, laps and site loss. Do this on the cost/material side; the
simplified billing rates already carry their own margin.

---

# Product system & TDS coverage

What the rates and quantities assume is installed. (Buy prices and full TDS data:
`take-off-web/dispatches/cost-data-memo.md §4–5.`)

| Step | Product | Where | Method |
|---|---|---|---|
| Primer | GCP Silcor BS Primer (20 L) | All substrates | ~80 m²/drum conservative |
| Floor membrane | GCP Silcor 560 HB charcoal (22 kg pail) | Floors | **Single thick high-build coat** (Driven's field method); TDS 2-coat coverage = 10.08 m²/pail @ Class III. Confirm coat count against the spec for the job. |
| Wall membrane | GCP Silcor 140 (drum) | Walls | Field-diluted ~50/50 with water as the primer coat, then membrane. (Invoices list it as "140 HB"; confirm exact grade if it matters for a spec submission.) |
| Fillet | SAS PU25 12 mm (carton, 12×600 ml) | Every internal corner / change of plane | ~14.4 lm of 12×12 mm fillet per carton |
| Joint tape | Butyl / Ardex STB15-75 (75 m roll) | Sheet joints + shelf joints | Suspended floors only for sheet joints |

### Coverage rates to size material orders
- **Silcor 560 HB:** 10.08 m² per 22 kg pail (2-coat Class III per TDS). If Driven lays
  a single thick coat, real coverage per pail is higher — use the job spec / Andy's
  call, and don't silently assume 2-coat consumption if it's a 1-coat job.
- **Enviro Prime P2 (alt primer):** 80 m² per 10 L kit @ 0.125 L/m².
- **SAS PU25:** ~14.4 lm of fillet per carton.
- **Butyl tape:** 75 m per roll.

Always add +10% wastage on top of the raw coverage calc.

## Why single thick coat matters
Driven's method on floors is a single high-build coat of 560 HB rather than the TDS
nominal 2-coat. This is a deliberate field choice (charcoal/zero product, high-build).
It changes material consumption per m² versus the TDS 2-coat figure — so for "how many
pails do I need", anchor to how Driven actually lays it, not the brochure number, and
note the assumption in the takeoff.
