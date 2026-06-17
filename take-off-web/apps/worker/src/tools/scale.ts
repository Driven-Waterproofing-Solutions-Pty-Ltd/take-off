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
import type { Env } from '../env';
import { getPage, parseScale, upsertPage, recalcItemTotal } from '../db/queries';

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
 */
async function recomputeShapesForPage(
  env: Env,
  projectId: string,
  pageIndex: number,
  scale: ScaleCalibration,
  prevUnit: Unit | null
): Promise<void> {
  const ppu = scale.pixelsPerUnit;
  if (!Number.isFinite(ppu) || ppu <= 0) return;

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
  if (shapeRows.length === 0) return;

  const itemIds = Array.from(new Set(shapeRows.map((r) => r.item_id)));
  const itemRows = (
    await env.DB.prepare(
      `SELECT id, type, unit, depth FROM items WHERE id IN (${itemIds.map(() => '?').join(',')})`
    )
      .bind(...itemIds)
      .all()
  ).results as unknown as ItemRowMin[];
  const itemTypeById = new Map(itemRows.map((r) => [r.id, r.type as ToolType]));

  // Multi-page guard: for any item that also has shapes on pages other than
  // `pageIndex`, check whether every other page already shares the new
  // linear unit. If not, the item gets its shape values recomputed on this
  // page but keeps its current global unit — relabeling would silently sum
  // ft values from page 2 under an m label. Mirrors the browser App.tsx
  // recalc guard added in the previous commit; without it REST/MCP recal
  // still corrupted totals on multi-page items.
  const otherPageRows = (
    await env.DB.prepare(
      `SELECT s.item_id, s.page_index
       FROM shapes s JOIN items i ON i.id = s.item_id
       WHERE i.project_id = ? AND s.page_index != ? AND s.item_id IN (${itemIds.map(() => '?').join(',')})`
    )
      .bind(projectId, pageIndex, ...itemIds)
      .all()
  ).results as Array<{ item_id: string; page_index: number }>;
  const otherPagesByItem = new Map<string, Set<number>>();
  for (const r of otherPageRows) {
    const set = otherPagesByItem.get(r.item_id) ?? new Set<number>();
    set.add(r.page_index);
    otherPagesByItem.set(r.item_id, set);
  }
  const allOtherPageIndexes = Array.from(
    new Set(otherPageRows.map((r) => r.page_index))
  );
  const otherPageUnitByIndex = new Map<number, Unit | null>();
  if (allOtherPageIndexes.length > 0) {
    const pageScaleRows = (
      await env.DB.prepare(
        `SELECT page_index, scale_json FROM pages
         WHERE project_id = ? AND page_index IN (${allOtherPageIndexes.map(() => '?').join(',')})`
      )
        .bind(projectId, ...allOtherPageIndexes)
        .all()
    ).results as Array<{ page_index: number; scale_json: string | null }>;
    for (const r of pageScaleRows) {
      if (!r.scale_json) {
        otherPageUnitByIndex.set(r.page_index, null);
        continue;
      }
      try {
        const parsed = JSON.parse(r.scale_json) as ScaleCalibration;
        otherPageUnitByIndex.set(
          r.page_index,
          parsed.isSet ? parsed.unit : null
        );
      } catch {
        otherPageUnitByIndex.set(r.page_index, null);
      }
    }
  }
  const safeToRetag = (itemId: string): boolean => {
    const pages = otherPagesByItem.get(itemId);
    if (!pages || pages.size === 0) return true;
    for (const p of pages) {
      if (otherPageUnitByIndex.get(p) !== scale.unit) return false;
    }
    return true;
  };

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
    await env.DB.prepare('UPDATE shapes SET value = ? WHERE id = ?').bind(nextValue, row.id).run();
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
    if (nextUnit && nextUnit !== row.unit && safeToRetag(row.id)) {
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
        const nextDepth = convertLinearUnit(row.depth, prevUnit, scale.unit);
        await env.DB.prepare(
          'UPDATE items SET unit = ?, depth = ?, updated_at = ? WHERE id = ?'
        )
          .bind(nextUnit, nextDepth, Date.now(), row.id)
          .run();
      } else {
        await env.DB.prepare('UPDATE items SET unit = ?, updated_at = ? WHERE id = ?')
          .bind(nextUnit, Date.now(), row.id)
          .run();
      }
    }
    await recalcItemTotal(env.DB, row.id);
  }
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
  const prevUnit = await capturePrevUnit(env, args.project_id, args.page_index);
  const scale: ScaleCalibration = {
    isSet: true,
    pixelsPerUnit: preset.pointsPerUnit,
    unit: preset.unit,
  };
  await upsertPage(env.DB, args.project_id, args.page_index, { scale });
  await recomputeShapesForPage(env, args.project_id, args.page_index, scale, prevUnit);
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

  const prevUnit = await capturePrevUnit(env, args.project_id, args.page_index);
  const scale: ScaleCalibration = {
    isSet: true,
    pixelsPerUnit: pixelDistance / args.real_distance,
    unit: args.unit,
  };
  await upsertPage(env.DB, args.project_id, args.page_index, { scale });
  await recomputeShapesForPage(env, args.project_id, args.page_index, scale, prevUnit);
  return scale;
}
