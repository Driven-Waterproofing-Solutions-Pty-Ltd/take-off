# Rate cards

Driven has three rate cards in play. Know which one you're pricing with. All are
**billing / charge-out** rates (what the builder pays). The **cost** side (material
buy prices, coverage, GP recipes) is separate and lives in
`take-off-web/dispatches/cost-data-memo.md`.

> Open item: the single "lay-for-gold" angle rate on the simplified card is **not yet
> confirmed**. Get the number from Andy before quoting angles on the simplified card.
> Do not substitute a guess.

---

## 1. CURRENT — Simplified estimator card (use this)

All-in installed rates. Lineal membrane, fillets, primer and labour are **baked into
the meterage** — you do not add a separate lineal line on top of a floor that already
has a floor rate. This is what makes a Leading Edge house land in the ~$6.6k–7.8k band
with one or two rates instead of a dozen granular lines.

| Line | Rate | Basis |
|---|---|---|
| Floor — any substrate | **$172.85 / m²** | Membraned floor footprint. Lineal/fillet/labour baked in. |
| Shower walls | **$55 / m²** | Wall length × waterproofed height |
| Perimeter-only flashing | **$28 / lin m** | Wet area that gets edge flashing but no full floor membrane |
| Shelves | **~$30–40 / lm** | Niche shelf / hob top |
| Niches | **$70 / each** | |
| Wastes | **$55 / each** | Stainless "smart" plate = good margin. Gold/black finishes → bump the rate up. |
| Angles ("lay for gold") | **OPEN — confirm with Andy** | Single combined angle rate; number pending |

Notes:
- "Floor any substrate" deliberately does **not** split concrete vs timber on the
  billing side — the simplified card folds them into one number. (The *cost* side does
  split them, because timber adds sheet-joint tape; see the cost memo.)
- Don't double-charge lineal on a floor that's already on the $172.85/m² rate. Lineal
  ($28/lm) is for the perimeter-only case — a wet area flashed but not fully membraned.

## 2. OLD — Granular card (legacy; for reading old quotes)

The pre-simplification card. Useful for understanding historical quotes and for
sense-checking the cost recipes. Do not quote new work on this unless asked.

| Line | Rate |
|---|---|
| Lineal perimeter | $15 / lm |
| Shower tray (full butyl tray + wall + 2× poly) | $100–140 / m² |
| Internal floor — concrete out | $55–70 / m² |
| Internal floor — timber out | $70–90 / m² |
| Shower walls | $35–55 / m² |
| Angles | $100–120 |
| Wastes | $45 |

## 3. PROPOSED — 2026-05 rate uplift (from the 3-Unit Costing Reference)

The uplift set derived from the 3-Unit job analysis, which showed the Nov-2024 builder
pricelist running at a **net loss** on multi-level restricted-access jobs. Loaded into
D1 `assemblies` tagged `["builder","proposed","rates-2026-05"]`. Eight lines change:

| Line | Nov-2024 | Proposed 2026-05 |
|---|---|---|
| Lineal | $15 / lm | **$28 / lm** |
| Shower wall | $35 / m² | **$50 / m²** |
| Shower tray | $100 / m² | **$140 / m²** |
| (…and 5 more lines uplifted) | | |

The 3-Unit doc's headline: at the Nov-2024 pricelist a unit returned ~$7,838 revenue
for ~-$195 net; at the proposed rates ~$13,056/unit = 38.5% GP. The simplified card
(#1 above) is the operational expression of this uplift for single-dwelling builder
work like Leading Edge.

---

## How the cards relate to cost

The billing rate must clear the **40% GP floor** against material + loaded labour.
Material cost per output unit (e.g. ~$19.50/m² for a 1-coat slab floor, ~$66/m² for a
full shower tray, ~$8.82/lm fillet) is in `cost-data-memo.md §6 (cost recipes)`. Use
that to compute GP% on any quote and to answer "what do I need to buy for this job?"
(walk items → assembly → cost recipe → coverage rate × +10% waste).
