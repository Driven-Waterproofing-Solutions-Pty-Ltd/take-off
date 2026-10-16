import {
  PRESET_SCALES,
  calculateDistance,
  calculatePolylineLength,
  calculatePolygonArea,
  calculateArcLength,
  convertLinearUnit,
  getScaledArea,
  getScaledValue,
  getAreaUnitFromLinear,
  getVolumeUnitFromLinear,
  ScaleCalibration,
  ToolType,
  Unit,
  Point,
} from '@takeoff/shared';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { getPage, parseScale, upsertPage, upsertPageStatement } from '../db/queries';

interface ShapeRowMin {
  id: string;
  item_id: string;
  points_json: string;
  bulges_json: string | null;
  value: number;
  deduction: number;
}

interface ItemRowMin {
  id: string;
  type: string;
  unit: string;
  depth: number | null;
}

/**
 * After a page's scale changes, every shape on that page was measured against
 * the OLD pixels-per-unit. Without recomputing, shapes.value / items.total_value
 * stay stale, build_quote prices the wrong quantities, and the canvas
 * disagrees with the server on reload. Mirrors the browser-side
 * handleUpdateScale recompute loop so REST/MCP scale changes match.
 *
 * Returns the write statements instead of running them: applyScale commits
 * them together with the new page scale in ONE db.batch() transaction, so a
 * failure can't leave the new scale beside half-rewritten values. The writes
 * are SET-BASED — at most three statements however many shapes/items the
 * page has (new values travel as one JSON parameter expanded with
 * json_each) — because every statement in a batch still counts toward D1's
 * per-invocation query limit (50 on Workers Free).
 */
async function recomputeStatementsForPage(
  env: Env,
  projectId: string,
  pageIndex: number,
  scale: ScaleCalibration,
  prevUnit: Unit | null
): Promise<D1PreparedStatement[]> {
  const ppu = scale.pixelsPerUnit;
  if (!Number.isFinite(ppu) || ppu <= 0) return [];
  const shapeValues: Array<{ id: string; value: number }> = [];
  const itemUpdates: Array<{ id: string; unit: string; depth: number | null }> = [];

  const shapeRows = (
    await env.DB.prepare(
      `SELECT s.id, s.item_id, s.points_json, s.bulges_json, s.value, s.deduction
       FROM shapes s
       JOIN items i ON i.id = s.item_id
       WHERE i.project_id = ? AND s.page_index = ?`
    )
      .bind(projectId, pageIndex)
      .all()
  ).results as unknown as ShapeRowMin[];
  if (shapeRows.length === 0) return [];

  // Join rather than `id IN (…)` so a page with more than 100 items stays
  // under D1's 100-bound-parameter limit.
  const itemRows = (
    await env.DB.prepare(
      `SELECT DISTINCT i.id, i.type, i.unit, i.depth
         FROM items i
         JOIN shapes s ON s.item_id = i.id
        WHERE i.project_id = ? AND s.page_index = ?`
    )
      .bind(projectId, pageIndex)
      .all()
  ).results as unknown as ItemRowMin[];
  const itemTypeById = new Map(itemRows.map((r) => [r.id, r.type as ToolType]));

  const areaUnit = getAreaUnitFromLinear(scale.unit);
  const volumeUnit = getVolumeUnitFromLinear(scale.unit);

  for (const row of shapeRows) {
    const type = itemTypeById.get(row.item_id);
    if (!type) continue;
    const points = JSON.parse(row.points_json) as Point[];
    const bulges = row.bulges_json ? (JSON.parse(row.bulges_json) as number[]) : undefined;
    let nextValue = row.value;
    if (type === ToolType.AREA || type === ToolType.FILL || type === ToolType.VOLUME) {
      nextValue = getScaledArea(calculatePolygonArea(points), ppu);
    } else if (type === ToolType.LINEAR || type === ToolType.SEGMENT || type === ToolType.DIMENSION) {
      nextValue = getScaledValue(calculatePolylineLength(points), ppu);
    } else if (type === ToolType.ARC && points.length >= 2) {
      // Multi-vertex ARCs are stored as polylines of straight chords (the
      // canvas + useShapeSync share this convention — see the comment in
      // useShapeSync.ts around the ARC create branch). Recomputing the
      // value from points[0]→points[1] alone truncated every chord past
      // the first on recalibration and the item silently undercounted
      // until the shape was redrawn.
      const pixelLen =
        points.length > 2
          ? calculatePolylineLength(points)
          : calculateArcLength(points[0], points[1], bulges?.[0] ?? 0);
      nextValue = getScaledValue(pixelLen, ppu);
    } else {
      continue; // COUNT / NOTE carry annotation/count semantics independent of scale
    }
    shapeValues.push({ id: row.id, value: nextValue });
  }

  // Retune item units (AREA→sq_m, VOLUME→cu_m, LINEAR→m) and recompute totals.
  for (const row of itemRows) {
    let nextUnit: string | undefined;
    if (row.type === ToolType.AREA || row.type === ToolType.FILL) nextUnit = areaUnit;
    else if (row.type === ToolType.VOLUME) nextUnit = volumeUnit;
    else if (
      row.type === ToolType.LINEAR ||
      row.type === ToolType.ARC ||
      row.type === ToolType.SEGMENT ||
      row.type === ToolType.DIMENSION
    ) {
      nextUnit = scale.unit;
    }
    // Safe to retag: assertNoMixedUnitItems ran before the scale was saved,
    // so no scaled item on this page also has shapes on a page measured in
    // a different unit.
    if (nextUnit && nextUnit !== row.unit) {
      // VOLUME items carry a depth in the page's linear unit. The browser
      // recalibration path converts it before folding into totalValue so a
      // 1 ft depth becomes 0.3048 m on a ft→m switch — without the same
      // conversion here, a server/MCP recalibration kept the raw "1" and
      // overstated the cubic quantity by ~3.28×.
      if (
        row.type === ToolType.VOLUME &&
        row.depth != null &&
        prevUnit &&
        prevUnit !== scale.unit
      ) {
        itemUpdates.push({
          id: row.id,
          unit: nextUnit,
          depth: convertLinearUnit(row.depth, prevUnit, scale.unit),
        });
      } else {
        // depth null = keep the stored depth (COALESCE below).
        itemUpdates.push({ id: row.id, unit: nextUnit, depth: null });
      }
    }
  }

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (shapeValues.length > 0) {
    const payload = JSON.stringify(shapeValues);
    stmts.push(
      env.DB.prepare(
        `UPDATE shapes
            SET value = (SELECT json_extract(j.value, '$.value') FROM json_each(?1) j
                          WHERE json_extract(j.value, '$.id') = shapes.id)
          WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`
      ).bind(payload)
    );
  }
  if (itemUpdates.length > 0) {
    const payload = JSON.stringify(itemUpdates);
    stmts.push(
      env.DB.prepare(
        `UPDATE items
            SET unit = (SELECT json_extract(j.value, '$.unit') FROM json_each(?1) j
                         WHERE json_extract(j.value, '$.id') = items.id),
                depth = COALESCE((SELECT json_extract(j.value, '$.depth') FROM json_each(?1) j
                                   WHERE json_extract(j.value, '$.id') = items.id), depth),
                updated_at = ?2
          WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`
      ).bind(payload, now)
    );
  }
  // Every item with a shape on this page gets its total recomputed from the
  // (just updated) shape values — one statement for all of them.
  stmts.push(
    env.DB.prepare(
      `UPDATE items
          SET total_value = (SELECT COALESCE(SUM(CASE WHEN s.deduction = 1 THEN -s.value ELSE s.value END), 0)
                               FROM shapes s WHERE s.item_id = items.id),
              updated_at = ?2
        WHERE project_id = ?1
          AND id IN (SELECT item_id FROM shapes WHERE page_index = ?3)`
    ).bind(projectId, now, pageIndex)
  );
  return stmts;
}

/**
 * Refuse a recalibration that would leave an item summing shape values in
 * two different units. If a scaled item on `pageIndex` also has shapes on
 * another page whose scale is unset or uses a different linear unit, changing
 * this page would rewrite only this page's shape values; the item's single
 * unit label can't describe both, so totals and quotes would mix e.g. metres
 * with feet. Runs BEFORE anything is written (the previous guard only skipped
 * the unit retag after the shape values had already been rewritten).
 * COUNT/NOTE are unit-independent and never block. Mirrors the browser's
 * pre-scan in App.tsx handleUpdateScale.
 */
async function assertNoMixedUnitItems(
  env: Env,
  projectId: string,
  pageIndex: number,
  unit: Unit
): Promise<void> {
  const rows = (
    await env.DB.prepare(
      `SELECT DISTINCT i.id, i.label, s.page_index
         FROM items i
         JOIN shapes s ON s.item_id = i.id
        WHERE i.project_id = ?
          AND i.type NOT IN ('COUNT', 'NOTE')
          AND s.page_index != ?
          AND i.id IN (
                SELECT s2.item_id FROM shapes s2
                  JOIN items i2 ON i2.id = s2.item_id
                 WHERE i2.project_id = ? AND s2.page_index = ?)`
    )
      .bind(projectId, pageIndex, projectId, pageIndex)
      .all()
  ).results as Array<{ id: string; label: string; page_index: number }>;
  if (rows.length === 0) return;

  const pageRows = (
    await env.DB.prepare('SELECT page_index, scale_json FROM pages WHERE project_id = ?')
      .bind(projectId)
      .all()
  ).results as Array<{ page_index: number; scale_json: string | null }>;
  const unitByPage = new Map<number, Unit | null>();
  for (const r of pageRows) {
    let pageUnit: Unit | null = null;
    if (r.scale_json) {
      try {
        const parsed = JSON.parse(r.scale_json) as ScaleCalibration;
        pageUnit = parsed.isSet ? parsed.unit : null;
      } catch {
        pageUnit = null;
      }
    }
    unitByPage.set(r.page_index, pageUnit);
  }
  for (const r of rows) {
    const otherUnit = unitByPage.get(r.page_index) ?? null;
    if (otherUnit !== unit) {
      throw new Error(
        `Cannot recalibrate page ${pageIndex} to "${unit}": item "${r.label}" also has shapes on page ${r.page_index}, which is ${otherUnit ? `measured in "${otherUnit}"` : 'not calibrated'}. Recalibrate that page first or split the item.`
      );
    }
  }
}

// Save the page scale and every dependent recomputation atomically.
async function applyScale(
  env: Env,
  projectId: string,
  pageIndex: number,
  scale: ScaleCalibration
): Promise<void> {
  await assertNoMixedUnitItems(env, projectId, pageIndex, scale.unit);
  const prevUnit = await capturePrevUnit(env, projectId, pageIndex);
  const recompute = await recomputeStatementsForPage(env, projectId, pageIndex, scale, prevUnit);
  await env.DB.batch([upsertPageStatement(env.DB, projectId, pageIndex, { scale }), ...recompute]);
}

async function capturePrevUnit(
  env: Env,
  projectId: string,
  pageIndex: number
): Promise<Unit | null> {
  // Capture the OLD linear unit before upsertPage overwrites it; used to
  // convert VOLUME depth when a page's unit changes (ft → m, etc.).
  const existing = await getPage(env.DB, projectId, pageIndex);
  if (!existing) return null;
  const prev = parseScale(existing);
  return prev.isSet ? prev.unit : null;
}

export async function setScalePreset(
  env: Env,
  args: { project_id: string; page_index: number; preset_label: string }
): Promise<ScaleCalibration> {
  const preset = PRESET_SCALES.find((p) => p.label === args.preset_label);
  if (!preset) {
    throw new Error(
      `Unknown preset "${args.preset_label}". Available: ${PRESET_SCALES.map((p) => p.label).join(', ')}`
    );
  }
  const scale: ScaleCalibration = {
    isSet: true,
    pixelsPerUnit: preset.pointsPerUnit,
    unit: preset.unit,
  };
  await applyScale(env, args.project_id, args.page_index, scale);
  return scale;
}

// Mark a page as uncalibrated again (the browser's Undo of a page's first
// calibration). Without it the server kept the undone scale, so a reload
// resurrected it and agent/MCP measurements kept using it while the browser
// showed the page as uncalibrated. Existing shape values are left as they
// are; the next calibration recomputes them.
export async function clearScale(
  env: Env,
  args: { project_id: string; page_index: number }
): Promise<ScaleCalibration> {
  const previous = parseScale(await getPage(env.DB, args.project_id, args.page_index));
  const scale: ScaleCalibration = { isSet: false, pixelsPerUnit: 0, unit: previous.unit };
  await upsertPage(env.DB, args.project_id, args.page_index, { scale });
  return scale;
}

export async function setScaleManual(
  env: Env,
  args: {
    project_id: string;
    page_index: number;
    p1: Point;
    p2: Point;
    real_distance: number;
    unit: Unit;
  }
): Promise<ScaleCalibration> {
  const pixelDistance = calculateDistance(args.p1, args.p2);
  if (pixelDistance <= 0) throw new Error('Calibration points are identical');
  if (args.real_distance <= 0) throw new Error('Real distance must be > 0');

  const scale: ScaleCalibration = {
    isSet: true,
    pixelsPerUnit: pixelDistance / args.real_distance,
    unit: args.unit,
  };
  await applyScale(env, args.project_id, args.page_index, scale);
  return scale;
}
