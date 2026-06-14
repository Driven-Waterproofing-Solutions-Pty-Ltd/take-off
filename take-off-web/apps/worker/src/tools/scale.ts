import {
  PRESET_SCALES,
  calculateDistance,
  calculatePolylineLength,
  calculatePolygonArea,
  calculateArcLength,
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
import { upsertPage, recalcItemTotal } from '../db/queries';

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
  scale: ScaleCalibration
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
      `SELECT id, type, unit FROM items WHERE id IN (${itemIds.map(() => '?').join(',')})`
    )
      .bind(...itemIds)
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
      nextValue = getScaledValue(calculateArcLength(points[0], points[1], bulges?.[0] ?? 0), ppu);
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
    if (nextUnit && nextUnit !== row.unit) {
      await env.DB.prepare('UPDATE items SET unit = ?, updated_at = ? WHERE id = ?')
        .bind(nextUnit, Date.now(), row.id)
        .run();
    }
    await recalcItemTotal(env.DB, row.id);
  }
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
  await upsertPage(env.DB, args.project_id, args.page_index, { scale });
  await recomputeShapesForPage(env, args.project_id, args.page_index, scale);
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
  await upsertPage(env.DB, args.project_id, args.page_index, { scale });
  await recomputeShapesForPage(env, args.project_id, args.page_index, scale);
  return scale;
}
