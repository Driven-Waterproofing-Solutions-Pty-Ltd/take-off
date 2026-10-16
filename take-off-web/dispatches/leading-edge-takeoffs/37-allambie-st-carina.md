# 37 Allambie St, Carina — Leading Edge takeoff

**Builder:** Leading Edge Constructions  
**Architect:** Pavilion Studio (Reg. 5149)  
**Plan source:** Google Drive — `Site 2- 37 Allambie_F NO LANDSCAPING.pdf` (2.3 MB, 14 sheets, A3)  
**Rate card:** Leading Edge simplified estimator  
**Result:** **$6,802 inc GST · 43.4 % GP**

---

## What I did

Followed the `waterproofing-takeoff` skill end-to-end:

1. **Retrieved** the PDF bytes from Drive (skill rule: never measure off a SharePoint text extract — get the actual file). Base64-decoded to `/tmp/takeoff/allambie37/plan.pdf`.
2. **Rasterised every sheet** with `pdftoppm -r 75` to identify which sheets matter for waterproofing, then re-rasterised the wet-area-relevant sheets at 300 DPI for dimension reading.
3. **Walked all 14 sheets** visually:
   - 1 Cover · 2 Site Plan · 3 Ground Floor · 4 Level 1 · 5 Elevations 1 · 6 Elevations 2 · 7 (3D) · 8 Electrical · 9 Roof · 10 Slab & Penetration · 11 Building Details · 12 Sections · **13 Wet Area Details** · 14 Liveable Housing.
4. **Confirmed builder = Leading Edge** off the cover title block ("PROPOSED RESIDENCE FOR Leading Edge Constructions") so the simplified estimator rate card applies.
5. **Established substrate per floor** from the section detail on page 12:
   - Ground floor = **concrete slab** (no horizontal sheet joints to tape).
   - Level 1 = **19 mm Structa floor on 400H joists** (suspended timber — sheet joints get butyl tape on L1 wet areas per the counting rule).
6. **Identified wet areas** from sheet 13 (Wet Area Details) — five waterproofed zones:
   - L1: **Ensuite** (off master), **Bathroom**, **WC** (separate compartment beside bath).
   - GF: **Powder** (with 900 × 900 shower — guest shower/PDR), **Laundry**.
7. **Measured every wet room internally** off sheet 13 — figured dimensions read directly off the page (skill rule: figured dimensions over scaling).
8. **Counted shower bases + fillets** off the wet-area detail sheet.
9. **Priced** on the LE simplified estimator card (`reference/rate-cards.md`).
10. **GP-checked** against material cost recipes (cost-data-memo §6) + 3-day loaded labour at $95 / hr — typical for a 2-storey job with 5 wet areas.

---

## Measurements (off sheet 13, figured dimensions)

Floor m² = internal (wall thickness 70 mm inset).

| Wet area | Level | Substrate | External W × D (mm) | Internal m² |
|---|---|---|---|---|
| Ensuite | L1 | Structa floor | 3560 × 2880 | 9.37 |
| Bathroom | L1 | Structa floor | 2240 × 3000 | 6.01 |
| WC | L1 | Structa floor | 1200 × 3000 | 3.03 |
| Powder + shower | GF | Slab | 2810 × 1820 | 4.49 |
| Laundry | GF | Slab | 1810 × 2440 | 3.84 |
| **Total wet floor** | | | | **26.73** |

Shower bases (from sheet 13):

| Shower | Tray (mm) | 3-wall perimeter (mm) | Wall area @ 1.8 m (m²) |
|---|---|---|---|
| Ensuite | 1890 × 1070 | 4030 | 7.25 |
| Bath | 2150 × 1000 | 4150 | 7.47 |
| Powder | 900 × 900 | 2700 | 4.86 |
| **Total shower walls** | | | **19.58** |

Counts:

- **Wastes:** 5 (3 shower wastes + bathroom floor waste + laundry floor waste). The WC compartment drains through the toilet, no separate waste.
- **Niches:** 3 (1 per shower).
- **Shelves:** none called up on the wet-area detail — confirm on site.

---

## Counting + method notes (per the skill)

- **GF wet areas (Powder, Laundry):** wall-to-floor fillet around the full internal perimeter. No horizontal sheet-joint tape (slab).
- **L1 wet areas (Ens, Bath, WC):** wall-to-floor fillet around the full perimeter + butyl tape on every Structa sheet joint within the wet-area footprint + vertical fillets only at change-of-plane corners. The 19 mm Structa Floor on 400H joists confirms suspended timber.
- **Product system** = GCP Silcor (BS Primer → Silcor 560 HB charcoal on floors, single thick high-build coat per Driven's field method; Silcor 140 on walls, field-diluted ~50/50 with water as the primer coat). +10 % wastage on all TDS quantities. SAS PU25 12 mm fillet at every internal corner and change of plane.

---

## Priced quote (LE simplified estimator)

| Line | Qty | Rate | Amount |
|---|---:|---:|---:|
| Floor (any substrate) | 26.73 m² | $172.85 | $4,621.14 |
| Shower walls | 19.58 m² | $55.00 | $1,077.12 |
| Wastes | 5 ea | $55.00 | $275.00 |
| Niches | 3 ea | $70.00 | $210.00 |
| **Subtotal ex GST** | | | **$6,183.26** |
| GST 10 % | | | $618.33 |
| **Total inc GST** | | | **$6,801.59** |

### GP check
- Materials est: ~$1,222 (floor $19.50/m² + walls $24.80/m² + wastes $42.90 ea, per cost-data-memo §6)
- Loaded labour: 3 days × 8 hr × $95/hr = $2,280
- Total cost: ~$3,502
- **GP 43.4 %** — over the 40 % floor.

---

## Sanity check vs worked examples

Within the LE band ($6,600–$7,800 for the worked-examples set: Glen Retreat ~$6,620, Kinnen ~$6,691, Varcoe ~$7,008, Redwood ~$7,142, White ~$7,247, Nellie ~$7,791). Allambie at $6,802 sits in the lower-middle of that band — consistent with a moderate-size 5-wet-area 2-storey.

---

## Caveats / confirm-on-site

- **Waste finishes NOT checked on this set.** Architectural plans don't show waste colour — that comes from the builder's PC item / colour selections list. Quoted at the flat $55/ea (chrome / standard stainless). If LE colour selections specify brushed gold or matte black on any waste, bump per cost-data-memo §4 (Plastec Smart $65 billing, gold/black higher again).
- Wall thicknesses assumed 70 mm internal partition (matches the figured 70 mm bay widths on sheet 13). External walls vary; floor m² uses internal-clear dimensions throughout.
- Shelves not separately quoted — none called up on the wet-area details, but Pavilion's note "TILE LEGEND" calls out skirting tiles and 1200H wall tiles in some zones; if site reveals tiled shelves they're +$30–40/lm extra.
- "Lay-for-gold" angle rate left open per the skill — angles not separately quoted because the simplified card doesn't yet have a confirmed angle line item.
- Alfresco (16.64 m²) is exterior at-grade — NOT waterproofed unless the spec calls for a slab-edge sealant; nothing on sheet 13 indicates it does.
