-- Seed for takeoff_knowledge. Idempotent via INSERT OR REPLACE keyed on id.
-- Apply to production D1 by running each statement via the Cloudflare D1
-- MCP query tool (or wrangler d1 execute --remote). Re-running just
-- overwrites — safe to re-seed after edits.

-- ====== METHODOLOGY ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('m-overview', 'methodology', 'Workflow overview',
'The skill, end-to-end:

1. Get the actual plan PDF bytes in front of you (SharePoint text extract is not enough — needs the raster).
2. Rasterise every sheet at 200 DPI (`pdftoppm -r 200`). Read every page image. Architectural sets spread wet-area info across 15–20 sheets.
3. Identify wet areas and substrate per floor (slab vs suspended timber). Slab = no horizontal sheet joints to tape; suspended timber = tape every Structafloor sheet joint.
4. Measure off the figured dimensions on the Wet Area Details sheet (Pavilion Studio puts it at sheet 13 or 14 on LE jobs). Figured dimensions over scaling; raster over text extract.
5. Count fillets + junctions per the photo-calibrated rule (see topic ''counting-rule'').
6. Price on the relevant rate card (see topic ''rate-cards-current''; non-LE builders need their own rate sheet, never default to LE).
7. GP check against material cost recipes + loaded labour. 40% GP floor.
8. Sanity check against worked-examples band (see topic ''worked-examples'').
9. Present and stop for human review. Never push to Xero from the agent.

Hard rule that overrides everything: NEVER fabricate a measurement. If you cannot see the rasterised sheet, you cannot do the takeoff — say so and stop.',
NULL, strftime('%s', 'now') * 1000);

-- ====== COUNTING RULE ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('c-rule', 'counting-rule', 'Photo-calibrated fillet / junction count',
'Calibrated against real site photos so the paper count matches what gets installed.

**Wall-to-floor junctions:** count EVERYWHERE membrane goes. Full internal perimeter of every wet-area floor gets a SAS PU25 12mm fillet.

**Vertical lines on the plan:** count a corner fillet ONLY at a change of plane (actual internal corner where the wall turns). Do NOT count nail-head runs, stud lines, door openings, or hatching/dimension witness lines.

**Horizontal lines on the plan:** sheet joints. Tape with Ardex STB15-75 butyl. Count ONLY on suspended-timber upper floors (19mm Structafloor on 400H joists is the LE Pavilion default for L1). On ground-floor concrete slab there are no sheet joints — ignore horizontal lines.

**Wastage:** apply +10% on every membrane / fillet / tape quantity derived from the TDS coverage rate.',
NULL, strftime('%s', 'now') * 1000);

-- ====== PRODUCT SYSTEM ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('p-system', 'product-system', 'GCP Silcor product system + TDS coverage',
'What the rates assume is installed.

| Step | Product | Where | Method / coverage |
|---|---|---|---|
| Primer | GCP Silcor BS Primer 20L | All substrates | ~80 m²/drum conservative |
| Floor membrane | GCP Silcor 560 HB charcoal (22 kg pail) | Floors | Driven''s field method = single thick high-build coat. TDS 2-coat rate = 10.08 m²/pail @ Class III. Use the job spec; do not silently assume 2-coat consumption on a 1-coat job. |
| Wall membrane | GCP Silcor 140 (drum) | Walls | Field-diluted ~50/50 with water as primer coat, then membrane. ~10 m²/drum @ 1-coat. |
| Fillet | SAS PU25 12 mm (carton, 12×600 ml) | Every internal corner / change of plane | ~14.4 lm of fillet per carton. |
| Joint tape | Ardex STB15-75 butyl (75 m roll) | Sheet joints + shelf joints | Suspended floors only for sheet joints. |
| Primer (alt) | Hychem Enviro Prime P2 (10 L kit) | Substrate | 80 m²/kit @ 0.125 L/m². |

+10% wastage on every quantity derived from a TDS rate.',
NULL, strftime('%s', 'now') * 1000);

-- ====== PLAN RETRIEVAL ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('r-paths', 'plan-retrieval', 'Where the plans live + how to pull bytes',
'**SharePoint (preferred for builder jobs):**
- Builder plans: `01_BUILDERS/<Builder>/`.
- Leading Edge: `01_BUILDERS/Leading_Edge/`, drive id `b!mUMgiiHsb0GM2iN0QYbT8l21Y7kyjPBFuXMTpqR-uCKXKVmHsjiPTa9FGV4lQry7`.
- Per-job folder: `01_JOBS/DW-YYYY-NNNN-<name>/01_DOCUMENTS/<name> FFE Schedule.pdf` AND the plan PDF.
- `02_PLANS_SPECS/` holds plan + FFE files by date.

**SharePoint retrieval gotcha:** the `read_resource` MCP tool returns extracted text only, not the file bytes. For visual measurement you need bytes — either Drive copy, or a Graph-raw download fallback (`GET /drives/{driveId}/items/{itemId}` WITHOUT `$select` so `@microsoft.graph.downloadUrl` survives, then curl).

**Google Drive (works when the plan is mirrored there):**
- `mcp__0dfd...__download_file_content` returns the file as base64. Per-response token cap means files >~5 MB fail; pull a slimmer copy or split.
- 37 Allambie (Drive id `1WwI-VZ_yUkjjWCFRmUMQAU_WyHj192P0`) and 76 Reuben (`1iwJZ_MMWCdmAFLIUzCX3t3M8tfQH-std`) are confirmed retrievable.
- Canonbar Lot 29 (`1yFq4zl_X1Fvfsd3Aj_2SbLsZRgpcLCn8`, 7.3 MB) exceeds the cap.

**Hard checks before measuring:**
- Confirm the lot/job/builder on the title block matches the request (Risley Feb-2026 email carried wrong-dwelling plans; always verify).
- Confirm the set is complete and legible. Missing sheets → request the correct file, don''t infer.',
NULL, strftime('%s', 'now') * 1000);

-- ====== RATE CARDS ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('rc-current', 'rate-cards-current', 'Current simplified estimator (LE billing rates)',
'All-in installed rates. Lineal membrane / fillets / primer / labour are baked into the m² rate — DO NOT double-charge lineal on a floor that already has a floor rate.

| Line | Rate | Basis |
|---|---|---|
| Floor — any substrate | **$172.85 / m²** | Membraned floor footprint. |
| Shower walls | **$55 / m²** | Wall length × waterproofed height (1.8 m default). |
| Perimeter-only flashing | **$28 / lin m** | Wet area with edge flashing but no full floor membrane. |
| Shelves | **~$30–40 / lm** | Niche shelf / hob top. |
| Niches | **$70 / each** | |
| Wastes | **$55 / each** | Chrome / standard stainless. Brushed gold / matte black tile insert / Plastec Smart bump higher — see topic ''waste-finish''. |
| Angles ("lay for gold") | **OPEN — confirm with Andy** | Number pending, do not invent. |

**Builder ≠ Leading Edge?** This card is LE-specific. For DJ Roberts, Hallmark, Hastie, AHC, etc., get the builder''s rate sheet first or flag "rate pending" — don''t silently default to LE rates on a non-LE plan.',
'leading-edge', strftime('%s', 'now') * 1000);

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('rc-legacy', 'rate-cards-legacy', 'Legacy granular card (pre-simplification)',
'For reading old quotes and sanity-checking cost recipes. Not for new work unless asked.

| Line | Rate |
|---|---|
| Lineal perimeter | $15 / lm |
| Shower tray (full butyl tray + wall + 2× poly) | $100–140 / m² |
| Internal floor — concrete out | $55–70 / m² |
| Internal floor — timber out | $70–90 / m² |
| Shower walls | $35–55 / m² |
| Angles | $100–120 |
| Wastes | $45 |',
NULL, strftime('%s', 'now') * 1000);

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('rc-proposed', 'rate-cards-proposed', 'Proposed 2026-05 rate uplift (8-line bump)',
'From the 3-Unit Costing Reference analysis. Loaded in D1 ``assemblies`` tagged ``["builder","proposed","rates-2026-05"]``. Eight lines change vs Nov-2024:

| Line | Nov-2024 | Proposed 2026-05 |
|---|---|---|
| Lineal | $15 / lm | **$28 / lm** |
| Shower wall | $35 / m² | **$50 / m²** |
| Shower tray | $100 / m² | **$140 / m²** |
| (+5 other lines uplifted to clear the GP floor on multi-level access jobs) | | |

3-Unit headline: at Nov-2024 rates the job returned ~$7,838/unit for a ~$195 net loss; at proposed rates ~$13,056/unit = 38.5% GP. The simplified card (topic rate-cards-current) is the operational expression of this uplift for single-dwelling LE work.',
'leading-edge', strftime('%s', 'now') * 1000);

-- ====== LABOUR ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('l-rates', 'labour-rates', 'Loaded labour cost (not charge-out)',
'**Tradesman**: $95/hr (Base $40 + 35% statutory + $45.6k/yr overhead ÷ 1,650 productive hrs)
**Offsider**: $60/hr (Base $25 + 35% statutory + $19.3k/yr overhead ÷ 1,650 productive hrs)

These are COST, not charge-out. The published builder pricelist bundles labour into the per-unit rate; these labour rates are only used for time-based jobs (callbacks, leak detection) and for GP calculation.

**Typical LE job durations:**
- Single-storey: ~2 days solo
- 2-storey with 4-5 wet areas: ~3 days
- No multi-level / restricted-access loading for Leading Edge — margin is baked into the per-m² rate.',
NULL, strftime('%s', 'now') * 1000);

-- ====== WORKED EXAMPLES ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('w-le-band', 'worked-examples', 'Leading Edge worked examples — calibration band',
'A typical LE single-dwelling lands **~$6,600–$7,800 inc GST**. Use as a plausibility check on new numbers; do NOT copy quantities across jobs.

| Job | Total inc GST | Notes |
|---|---:|---|
| Glen Retreat | ~$6,620 | 44% GP, FFE on file (Eliza Grace Interiors) |
| Kinnen | ~$6,691 | 2 days, 46% GP, FFE on file |
| Varcoe | ~$7,008 | |
| Redwood | ~$7,142 | FFE on file |
| White | ~$7,247 | 48% GP |
| Nellie | ~$7,791 | 3 days (bigger job) |
| **37 Allambie** | **$6,802** | This session — 43.4% GP, 5 wet areas, 2-storey |
| **76 Reuben** | **$6,131** | This session — 38.5% GP, smaller wet floor, just under floor |

A new comparable LE result far outside $6.6–7.8k → re-check the wet-area count + floor m² before presenting. The usual cause is over-counting wet areas (tiled robes/halls treated as membraned) or a floor-area error.

**Blocked / outstanding** (per cost memo):
- Risley — wrong BA plans sent by LE in Feb 2026; chase Harry Carter.
- Canonbar Lot 29 — Drive copy exists but exceeds connector size cap.
- Allambie / Leonard Cres / Douglas St / Tuckerman / Driver — Allambie ✅ done; the others not located in Drive (SharePoint-only).',
'leading-edge', strftime('%s', 'now') * 1000);

-- ====== PAVILION STUDIO TEMPLATE (LE) ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('pt-le', 'pavilion-template', 'Pavilion Studio sheet layout (LE plans)',
'Pavilion Studio (Reg. 5149) draws every Leading Edge job. The sheet layout is consistent:

- **Sheet 1** — Cover (confirm "PROPOSED RESIDENCE FOR Leading Edge Constructions" before applying the LE simplified rate card)
- **Sheet 2** — Site Plan
- **Sheet 3** — Ground Floor
- **Sheet 4** — Level 1
- **Sheet 5–6** — Elevations
- **Sheet 7** — 3D renders
- **Sheet 8** — Electrical
- **Sheet 9** — Roof
- **Sheet 10** — Slab & Penetration plan (shows every FW, SHR, SK, VB, WC, T penetration with dimensions)
- **Sheet 11** — Wall Details
- **Sheet 12** — Sections (this is where substrate is confirmed: GF = waffle pod slab on ground, L1 = 19 mm Structafloor on 400H joists)
- **Sheet 13 OR 14** — **Wet Area Details** ← measure off this sheet (Kitchen / Butler''s / Laundry strip, Ensuite, Bath, Powder, each with figured dimensions and shower tray sizes)
- **Final sheet** — Liveable Housing Design standard (LHD reinforcing callouts in red dashed line)

**Substrate convention:** L1 wet areas always get sheet-joint tape (suspended timber). GF wet areas don''t (slab).

**Internal wall thickness** is 70 mm on every Pavilion wet-area detail — bay strings read "70 [bay] 70". Compute floor m² as `(W-140)*(D-140)` for internal-clear area.

**Sheet 13 wet legend** carries TILE LEGEND ONLY (LHA reinforcing, splashback, full HT wall, skirting, 1200H wall). Waste finishes are NOT on this sheet — they''re on the FFE Schedule (see topic ''ffe-schedule'').',
'leading-edge', strftime('%s', 'now') * 1000);

-- ====== FFE SCHEDULE ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('ffe-le', 'ffe-schedule', 'Leading Edge FFE Schedule — where it lives and what it specifies',
'**FFE (Finishes, Fittings & Equipment) Schedule** ships bundled WITH the plan, as a separate PDF.

**SharePoint location:** `01_BUILDERS/Leading_Edge/01_JOBS/DW-YYYY-NNNN-<job>/01_DOCUMENTS/<job> FFE Schedule.pdf` (also mirrored in `02_PLANS_SPECS/<date>_<job> FFE Final.pdf`).

**FFE schedules confirmed on file:**
- Glen Retreat (67 Glen Retreat Rd, Mitchelton) — read in full
- Kinnen (19 Kinnen St, Enoggera)
- Redwood (127 Redwood St)
- Risley (9 Risley St, Carina — blocked job)

**Designer:** Eliza Grace Interiors (elizagraceinteriors.com) draws the LE FFE schedules.

**LE / Eliza Grace aesthetic** (confirmed from Glen Retreat FFE):
- Wet area basin tap: Cooks Plumbing Lilian lever basin/bath wall set — **matte black**
- Shower head/system: Cooks Plumbing Lilian twin shower — **black**
- Shower mixer: Cooks Plumbing Eleanor wall mixer — **matte black**
- Bath tap: Cooks Plumbing Lilian wall set — **matte black**
- Towel rails / hand towel ring / TRH / robe hooks: Cooks Plumbing Lilian — **matte black**
- Mirrors: Fienza Tono — **matte black** framed
- **Tile insert (floor waste grate): BLACK** for all wet areas ← this is what bumps the waste line vs chrome default
- Wet area basin wastes: gloss white ceramic pop-up
- Bath waste: brass cap, gloss white
- Toilet: Cooks Plumbing Isabella back-to-wall suite

**Pricing implication:** on any LE job with Eliza Grace selections, default the waste line from the $55 chrome rate to the higher black/tile-insert rate (per cost-data-memo §4). Confirm the actual rate with Andy — bump value is currently flagged as confirm-on-quote.',
'leading-edge', strftime('%s', 'now') * 1000);

-- ====== WASTE FINISH ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('wf-default', 'waste-finish', 'Waste finish pricing (chrome vs Plastec Smart vs gold/black)',
'Per cost-data-memo §4:

| Finish | Cost-side | Billing | Notes |
|---|---|---|---|
| 100mm Chrome Waste Standard | $42.90 / EA | $40 / EA | Slight loss on hardware-only line; absorbed in installed margin. |
| Plastec Smart Plate | $45 / EA | $65 / EA | Good margin. |
| Brushed gold | higher | higher (TBC) | LE Eliza Grace Interiors selection on some jobs. |
| Matte black tile insert | higher | higher (TBC) | LE default per Glen Retreat / Eliza Grace aesthetic. |

**Simplified card default** is $55/each (chrome). When the FFE Schedule specifies anything other than chrome, the line bumps — confirm the exact rate with Andy before quoting. Do not silently quote chrome on a black/gold spec.

**How to check:** read the FFE Schedule (topic ''ffe-schedule'') for "Tile Insert", "Bath Waste", "Wet Area Basin Waste" entries. The architectural drawing set does NOT carry waste finish callouts.',
NULL, strftime('%s', 'now') * 1000);

-- ====== TAKEOFF RECORDS (THIS SESSION) ======

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('tr-allambie37', 'takeoff-record', '37 Allambie St, Carina — LE, $6,802 inc GST, 43.4% GP',
'Builder: Leading Edge. Architect: Pavilion Studio. 2-storey, 5 wet areas.

**Substrate:** GF concrete slab, L1 19mm Structafloor on 400H joists.

**Wet floor (off sheet 13, 70mm wall inset):**
- Ensuite (L1, 3560×2880): 9.37 m²
- Bathroom (L1, 2240×3000): 6.01 m²
- WC (L1, 1200×3000): 3.03 m²
- Powder + 900×900 shower (GF, 2810×1820): 4.49 m²
- Laundry (GF, 1810×2440): 3.84 m²
- **Total: 26.73 m²**

**Shower walls @ 1.8m:**
- Ens 1890×1070: 7.25 m²
- Bath 2150×1000: 7.47 m²
- Pwd 900×900: 4.86 m²
- **Total: 19.58 m²**

Wastes 5 (3 shower + bath floor + laundry floor). Niches 3 (1 per shower).

**Priced (LE simplified, chrome default):** Floor $4,621.14 + Walls $1,077.12 + Wastes $275 + Niches $210 = $6,183.26 ex GST → **$6,801.59 inc GST**. GP 43.4% (mat ~$1,222 + 3-day labour $2,280 = $3,502 cost).

**Caveats:** waste finishes not verified (FFE Schedule not retrieved for Allambie). If LE Eliza Grace matte-black tile-insert wastes apply, bump the waste line.',
'leading-edge', strftime('%s', 'now') * 1000);

INSERT OR REPLACE INTO takeoff_knowledge (id, topic, title, body_md, builder, updated_at) VALUES
('tr-reuben76', 'takeoff-record', '76 Reuben St, Stafford — LE, $6,131 inc GST, 38.5% GP (UNDER FLOOR)',
'Builder: Leading Edge. Architect: Pavilion Studio. 2-storey, 5 wet areas.

**Substrate:** GF concrete slab, L1 19mm Structafloor on 400H joists.

**Wet floor (off sheet 14, 70mm wall inset):**
- Ensuite (L1, 3460×2865): 9.05 m²
- Bathroom (L1, 2050×2655): 4.80 m²
- WC TILES (L1, 1100×1700): 1.50 m²
- Powder + 900×900 shower (GF, 2520×1800): 3.95 m²
- Laundry (GF, 1900×2400): 3.98 m²
- **Total: 23.28 m²**

**Shower walls @ 1.8m:**
- Ens 1690×1160: 7.22 m²
- Bath 2050×1000: 7.29 m²
- Pwd 900×900: 4.86 m²
- **Total: 19.37 m²**

Wastes 5. Niches 3 (Pwd + Ens explicit on plan + assumed bath).

**Priced (LE simplified):** Floor $4,023.37 + Walls $1,065.24 + Wastes $275 + Niches $210 = $5,573.61 ex GST → **$6,130.97 inc GST**. GP 38.5% — **1.5 points UNDER the 40% floor** (smaller wet floor area + fixed 3-day labour).

**Action:** flag for rate review. Two options — take the lower GP, or apply the 2026-05 proposed uplift (→ ~$7.4k ex GST / ~50% GP). Andy to call.',
'leading-edge', strftime('%s', 'now') * 1000);
