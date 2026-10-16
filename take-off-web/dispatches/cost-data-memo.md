# Driven Waterproofing — Cost / Pricing Memory Layer

**Status:** Loaded into D1 production database `takeoff-production`.
**Last refreshed:** 2026-06-14 from Tilers Warehouse invoices Feb–Jun 2026 + GCP Silcor 560 HB TDS + Hychem Enviro Prime P2 TDS + 3-Unit Costing Reference doc (Drive).

This memo is the durable, git-tracked summary of every cost/pricing fact loaded into D1, plus the provenance for each number. Future agent runs (and humans) can find everything here.

## 1. Schema additions on `materials`

| Column | Type | Meaning |
|---|---|---|
| `coverage_rate` | REAL | How many output units one buy unit covers (e.g. 10.08 m² per 22kg pail) |
| `coverage_unit` | TEXT | The output unit, e.g. `'sq m / pail'`, `'lm / carton'`, `'sq m / 10L kit'` |
| `tds_url` | TEXT | Link to the manufacturer's TDS PDF, where available |
| `spec_notes` | TEXT | Mix ratio, pot life, recoat window, substrate notes, provenance of the coverage rate |

These columns are queryable via the existing `list_assemblies` MCP path; the agent surfaces them when asked *"how many drums for X m²?"*.

## 2. New table: `cost_recipes`

```sql
cost_recipes (
  assembly_id     TEXT REFERENCES assemblies(id),
  material_id     TEXT REFERENCES materials(id),
  qty_per_unit    REAL,        -- per 1 unit of the assembly's output (per m², per lm, per EA)
  waste_pct       REAL,        -- typically 5–10% depending on substrate
  labour_min_per_unit REAL,    -- usually 0 here; labour lives in labour_rates and is folded by the published rate
  notes           TEXT
);
```

This is the **forecast layer**: walk a project's items → billing assemblies → cost recipes → real material draw at coverage rates + waste. Powers *"what do I need to buy for this job?"* and *"what's my GP% on this quote?"*.

## 3. Tilers Warehouse invoices processed

| Invoice | Date | Subtotal ex-GST | Coverage notes |
|---|---|---|---|
| #015617 | 20 Feb 2026 | $4,291.49 | TTW extrusions, finishes (gunmetal, bright gold) |
| #016021 | 20 Feb 2026 | $17,074.02 | Big stock-up — Silcor, Hayman strip drains |
| #016125 | 27 Feb 2026 | $4,874.10 | + updated version $4,990.99 |
| #016313 | 17 Mar 2026 | $8,067.92 | Mid-month restock |
| #016466 | 26 Mar 2026 | $5,812.68 | Renox brushed gold T/I waste, Roberts trim |
| #016499 | 27 Mar 2026 | $195.00 | Ardex butynol top-up |
| #016845 | 28 Apr 2026 | $271.10 | Strathpine — Laticrete Gold Adhesive, Durotech silicone |
| #016881 | 29 Apr 2026 | $760.00 | Maxsilla Maxi Grab silicone clear |
| #016900 | 30 Apr 2026 | $298.60 | Fosberry St — Laticrete Latapoxy moisture shield |
| #017112 | 14 May 2026 | $17,972.31 | **The 3-Unit job stock-up — costing doc's source invoice** ✓ reconciles to the cent |
| #017179 | 20 May 2026 | $2,985.75 | Mid-May top-up |
| #017323 | 28 May 2026 | $2,448.00 | Durotech P15, more Streamline corners |
| #017431 | 5 Jun 2026 | $7,091.14 | Most recent — current prices |
| **Total (4 months)** | | **$72,258.00 ex-GST** | |

## 4. Confirmed-stable prices Feb→Jun 2026 (no drift)

Cross-invoice reconciliation:

| Product | $/buy unit | Confirmed across |
|---|---|---|
| GCP Silcor 560 HB Zero | $170 / 22 kg pail | 5 invoices |
| GCP Silcor 140 HB wall | $160 / drum | 3 invoices |
| GCP Silcor BS Primer 20L | $200 / drum | 2 invoices |
| SAS PU25 carton (12 × 600ml) | $126 / carton | 4 invoices |
| Ardex STB15-75 butynol tape | $65 / roll (75 m) | 3 invoices |
| TTW Streamline Shower Angle 4m | $190 / length | 2 invoices |
| 50mm Doorline 3m Bright Silver | $45.90 / length | 2 invoices |
| Mega Square 100mm floor drain | $48 / EA | 2 invoices |
| 11mm L Premium Profile 3m | $48 / length | 2 invoices |
| Plastec 100mm M/Adap chrome body | $30 / EA | 2 invoices |
| Smart Plate (Plastec) | $45 / EA cost-side ($65 billing) | 1 invoice |
| Puddle flange | $12.90 / EA | 2 invoices |

## 5. TDS data captured (with coverage rates)

### GCP Silcor 560 HB Zero — polyurethane membrane
- TDS: https://gcpat.com.au/sites/default/files/pdf/current/resource/GCPAT_silcor_560_hb_au_13996.pdf
- **Coverage: 10.08 m² per 22 kg pail @ 2-coat Class III External Above Ground or Internal Wet Area (AS 4654.1 / AS 4858)**
- Consumption: 2.18 kg/m² total @ 1.35 mm DFT / 1.48 mm WFT (sum of 2 coats)
- One-part, humidity-cured
- Min recoat 12 h, max recoat 48 h (warm/humid accelerates; cold extends)
- Bond breaker at movement joints: 12×12 mm internal, 15×15 mm external
- Apply between 35–85% RH; not at < 5°C or > 35°C substrate
- High build, seamless, fully bonded — no water tracking under membrane
- VOC < 110 g/L (Low VOC)
- Tensile > 3 MPa, elongation > 700%

### Hychem Envirosystems Enviro Prime P2 — 2-part PU primer
- TDS source: Drive — `TDS-Enviro-Prime-P2-R01-2024.pdf`
- **Coverage: 80 m² per 10 L kit @ 0.125 L/m² single coat, 125 μm WFT**
- Mix ratio 2.2:1 by weight (2.57:1 by volume) Part A:Part B
- Pot life 15 min
- Overcoat window: 4–72 h (24/16/96/7d cure stages at 10/15/25 °C)
- Substrate ≤ 4.5% moisture (gravimetric, Tramex CME 4)
- Apply at substrate temp 5–35 °C
- Cleanup: Enviro Thinners No.1 or No.7 prior to cure
- Suitable for concrete, block, render, timber, CFC, GRC, steel
- VOC 1 g/L, tensile bond > 3 MPa cohesive failure

### Empirical coverage rates (from 3-Unit Costing Reference + cross-invoice usage)
| Product | Coverage | Source |
|---|---|---|
| Silcor 140 HB wall | ~10 m²/drum @ 1-coat | 4.5 drums per 44.6 m² walls in costing doc |
| BS Primer 20L | ~80 m²/drum conservative | 0.5 drum per ~70 m² substrate per unit |
| SAS PU25 carton | ~14.4 lm of 12×12 mm fillet per carton | 7 cartons per 100.8 lm in costing doc |
| Ardex STB15-75 | 75 m per roll | Roll length spec |
| Durotech P15 Membrane | ~15 m²/15L tin @ 2-coat | Manufacturer published ~1 L/m² |
| Mapelastic Smart kit | ~4 m²/kit @ 2 mm × 2 coat | Mapei published ~7.5 kg/m² |
| Laticrete Latapoxy primer | ~80 m²/kit @ 0.125 L/m² | Similar to Enviro Prime epoxy class |

## 6. Cost recipes — top assemblies

Recipes per **unit of output** (m² for floor/wall, lm for lineal, EA for fittings). All loaded into `cost_recipes` table.

### Shower Wall ($35/m² billing)
- 0.10 drum/m² × Silcor 140 HB × $160 = **$16.00/m² membrane**
- 0.0125 drum/m² × BS Primer × $200 = $2.50/m² primer
- 0.05 carton/m² × SAS PU25 × $126 = $6.30/m² internal-corner fillet
- **Material cost ~$24.80/m²** | billing $35/m² → **29% material margin** (before sundries + labour). Apply +25% labour line and this loses money on multi-level access jobs per 3-Unit doc.

### Shower Tray ($100/m² billing, full butynol tray + 1× wall + 2× poly)
- 0.20 pail/m² × Silcor 560 HB × $170 = **$34.00/m² 2-coat poly**
- 0.10 drum/m² × Silcor 140 HB × $160 = $16.00/m² wall base
- 0.0125 drum/m² × BS Primer × $200 = $2.50/m²
- 1.50 lm/m² × Ardex STB15-75 × ($65 / 75 lm) = $1.30/m² butynol tape
- 0.10 carton/m² × SAS PU25 × $126 = $12.60/m² perimeter fillets
- **Material cost ~$66.40/m²** | billing $100/m² → **34% material margin**

### Internal Floor — Slab ($45/m² billing, 1-coat on concrete)
- 0.10 pail/m² × Silcor 560 HB × $170 = $17.00/m²
- 0.0125 drum/m² × BS Primer × $200 = $2.50/m²
- **Material cost ~$19.50/m²** | billing $45/m² → **57% material margin**

### Internal Floor — Scyon/CFC ($70/m²)
- 0.10 pail/m² × Silcor 560 HB × $170 = $17.00/m²
- 0.0125 drum/m² × BS Primer × $200 = $2.50/m²
- 1.20 lm/m² × Ardex STB15-75 × ($65/75) = $1.04/m² butynol over sheet joints
- **Material cost ~$20.54/m²** | billing $70/m² → **71% material margin**

### Lineal Perimeter ($15/lm billing)
- 0.07 carton/lm × SAS PU25 × $126 = $8.82/lm fillet
- 0.01 drum/lm × Silcor 140 HB × $160 = $1.60/lm membrane strip
- **Material cost ~$10.42/lm** | billing $15/lm → **31% material margin** (the line under-priced per 3-Unit doc rec; new $28/lm proposed)

### Balcony Floor ($65/m², external above-ground 2-coat)
- 0.12 pail/m² × Silcor 560 HB × $170 = $20.40/m² (2-coat AS 4654.1)
- 0.0125 drum/m² × BS Primer × $200 = $2.50/m²
- 1.20 lm/m² × Ardex STB15-75 = $1.04/m²
- **Material cost ~$23.94/m²** | billing $65/m² → **63% material margin**

### Planter / Retaining Poly ($100/m², heaviest membrane application)
- 0.25 pail/m² × Silcor 560 HB × $170 = $42.50/m² (2-coat + tie coat)
- 0.0125 kit/m² × Laticrete Latapoxy × $298.60 = $3.73/m² epoxy moisture barrier
- 1.0 sheet/m² × Corflute × $6.50 = $6.50/m² protection over membrane
- **Material cost ~$52.73/m²** | billing $100/m² → **47% material margin**

### Niche / Shower Window Seal ($55/EA)
- 0.20 carton/EA × SAS PU25 × $126 = $25.20/EA
- 0.05 drum/EA × Silcor 140 HB × $160 = $8.00/EA membrane on interior surfaces
- **Material cost ~$33.20/EA** | billing $55/EA → **40% margin**

### 100mm Chrome Waste Standard ($40/EA billing)
- 1 × Chrome body × $30 + 1 × Puddle flange × $12.90 = **$42.90/EA cost**
- Billing $40/EA — **slight loss on hardware-only line**; absorbed in floor/tray installed margin

## 7. The big picture (from 3-Unit Costing Reference)

The 3-Unit project doc is the canonical reference for what "real" looks like:

- **Materials per unit (9 wet areas):** $4,933 ex GST
- **Labour per unit (true cost-to-business):**
  - Benchmark (single tradesman, good access): $2,280
  - This job (2-man crew, multi-level, restricted): $8,480
- **At current builder pricelist, revenue per unit:** $7,838.60 → **net -$195/unit loss on this job**
- **At recommended new rates:** $13,056/unit → 38.5% GP

The new rates (8 lines change — Lineal $15→$28, Shower Wall $35→$50, Shower Tray $100→$140, etc.) are loaded as the `proposed` set in `assemblies` tagged `["builder","proposed","rates-2026-05"]`.

## 8. Labour rates (true cost-to-business)

| Role | Hourly | Build-up |
|---|---|---|
| Tradesman (fully loaded) | $95/hr | Base $40 + 35% statutory + $45.6K/yr overhead ÷ 1,650 productive hrs |
| Offsider (fully loaded) | $60/hr | Base $25 + 35% statutory + $19.3K/yr overhead ÷ 1,650 productive hrs |

These are **cost**, not charge-out. The published builder pricelist bundles labour into the per-unit rate; these labour rates are used only for time-based jobs (callbacks, leak detection) and for GP calculation purposes.

## 9. Customers — 105 from Xero

All Xero contacts synced via `/xero/sync`. Top 5 by revenue (FY 2025-26 to date):
1. Hallmark Homes — $165,388
2. Affordable Housing Corp (AHC) — $101,619
3. Hastie Homes — $68,822
4. LE Constructions — $60,926
5. Martin Corp Homes — $52,868

⚠️ Hallmark has an invoice 1000+ days overdue ($30,378). Separate issue.

AHC runs at standard list rates (no override) — two recent benchmarks:
- AHC Victory 5 Victory St Zillmere: PO $5,400, GP 20.8%
- AHC Wilmah 44 Wilmah St Aspley: PO $7,100, GP 23.8%

## 10. Source documents in Drive

- `Driven_3-Unit_Costing_Reference_2026-05-21` (Google Doc) — internal costing reference
- `3Unit_Builder_Pricing_Justification.docx` (May 22) — customer-facing rate-uplift pitch
- `Driven Pricelist (Builders nov 2024).docx` — canonical published rate sheet (25 lines)
- `TDS-Enviro-Prime-P2-R01-2024.pdf` — Hychem Enviro Prime P2 TDS
- Various plan PDFs in `LOT 4232`, `N696R`, etc. folders

## 11. What the agent can do with all this

When deployed (Anthropic key set + `/api/ai/turn` live), the in-app agent can:
- **`build_quote`** — uses billing assemblies as today, with full real-customer + Xero-pushable result
- **`list_assemblies`** — surfaces the assembly tree, with new TDS-driven coverage rates as columns
- **`recall_customer "hallmark"`** — returns the real Xero contact with `xeroContactId`
- **(future) `forecast_materials(project_id)`** — walks items × billing assemblies × `cost_recipes` × coverage_rate × waste_pct → returns total drums/cartons/rolls needed to BUY for this job, plus per-line GP%
- **(future) `apply_proposed_rates(project_id)`** — swaps the project from `current` to `proposed` assembly set in one move (one-line update on tag filter)

The cost-recipe layer is now D1-durable. The next agent run reads it just like any other table — no special wiring needed beyond a thin MCP tool on top.
