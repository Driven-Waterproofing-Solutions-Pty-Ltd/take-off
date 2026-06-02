import {
  Shape,
  Point,
  ToolType,
  calculatePolygonArea,
  calculatePolylineLength,
  calculateArcLength,
  getScaledArea,
  getScaledValue,
  getAreaUnitFromLinear,
  Unit,
} from '@takeoff/shared';
import type { Env } from '../env';
import {
  getOrCreateItem,
  insertShape,
  recalcItemTotal,
  getPage,
  parseScale,
} from '../db/queries';
import { snapToVector } from './snap';

async function maybeSnap(
  env: Env,
  projectId: string,
  pageIndex: number,
  points: Point[],
  snap: boolean | undefined
): Promise<Point[]> {
  if (snap === false) return points;
  const { snapped } = await snapToVector(env, {
    project_id: projectId,
    page_index: pageIndex,
    points,
  });
  return snapped;
}

interface AddCommon {
  project_id: string;
  page_index: number;
  item_id?: string;
  shape_id?: string;
  name?: string;
  color?: string;
  deduction?: boolean;
}

export async function addArea(
  env: Env,
  args: AddCommon & { points: Point[]; snap?: boolean }
): Promise<Shape> {
  const points = await maybeSnap(env, args.project_id, args.page_index, args.points, args.snap);
  const page = await getPage(env.DB, args.project_id, args.page_index);
  const scale = parseScale(page);
  if (!scale.isSet) {
    throw new Error(
      `Page ${args.page_index} scale is not calibrated. Call set_scale_preset or set_scale_manual first.`
    );
  }

  const pixelArea = calculatePolygonArea(points);
  const value = getScaledArea(pixelArea, scale.pixelsPerUnit);
  const areaUnit = getAreaUnitFromLinear(scale.unit);

  const item = await getOrCreateItem(env.DB, args.project_id, {
    id: args.item_id,
    label: args.name ?? 'Area',
    type: ToolType.AREA,
    unit: areaUnit,
    color: args.color ?? '#10b981',
  });

  const shape: Shape & { itemId: string } = {
    id: args.shape_id ?? crypto.randomUUID(),
    itemId: item.id,
    pageIndex: args.page_index,
    points,
    value,
    deduction: args.deduction,
  };
  await insertShape(env.DB, shape);
  await recalcItemTotal(env.DB, item.id);
  const { itemId: _itemId, ...result } = shape;
  return result;
}

export async function addLinear(
  env: Env,
  args: AddCommon & { points: Point[]; snap?: boolean }
): Promise<Shape> {
  const points = await maybeSnap(env, args.project_id, args.page_index, args.points, args.snap);
  const page = await getPage(env.DB, args.project_id, args.page_index);
  const scale = parseScale(page);
  if (!scale.isSet) throw new Error(`Page ${args.page_index} scale is not calibrated.`);

  const pixelLen = calculatePolylineLength(points);
  const value = getScaledValue(pixelLen, scale.pixelsPerUnit);

  const item = await getOrCreateItem(env.DB, args.project_id, {
    id: args.item_id,
    label: args.name ?? 'Linear',
    type: ToolType.LINEAR,
    unit: scale.unit,
    color: args.color ?? '#3b82f6',
  });

  const shape: Shape & { itemId: string } = {
    id: args.shape_id ?? crypto.randomUUID(),
    itemId: item.id,
    pageIndex: args.page_index,
    points,
    value,
    deduction: args.deduction,
  };
  await insertShape(env.DB, shape);
  await recalcItemTotal(env.DB, item.id);
  const { itemId: _itemId, ...result } = shape;
  return result;
}

export async function addCount(
  env: Env,
  args: AddCommon & { points: Point[] }
): Promise<Shape> {
  const item = await getOrCreateItem(env.DB, args.project_id, {
    id: args.item_id,
    label: args.name ?? 'Count',
    type: ToolType.COUNT,
    unit: Unit.EACH,
    color: args.color ?? '#ef4444',
  });

  const shape: Shape & { itemId: string } = {
    id: args.shape_id ?? crypto.randomUUID(),
    itemId: item.id,
    pageIndex: args.page_index,
    points: args.points,
    value: args.points.length,
    deduction: args.deduction,
  };
  await insertShape(env.DB, shape);
  await recalcItemTotal(env.DB, item.id);
  const { itemId: _itemId, ...result } = shape;
  return result;
}

export async function addNote(
  env: Env,
  args: AddCommon & { points: Point[]; text: string }
): Promise<Shape> {
  // Notes are annotations: no scale required, value carries the character
  // count for a stable non-zero "did this exist" hint in the DB.
  const item = await getOrCreateItem(env.DB, args.project_id, {
    id: args.item_id,
    label: args.name ?? 'Note',
    type: ToolType.NOTE,
    unit: Unit.EACH,
    color: args.color ?? '#6366f1',
  });

  const shape: Shape & { itemId: string } = {
    id: args.shape_id ?? crypto.randomUUID(),
    itemId: item.id,
    pageIndex: args.page_index,
    points: args.points,
    value: args.text.length,
    text: args.text,
    deduction: args.deduction,
  };
  await insertShape(env.DB, shape);
  await recalcItemTotal(env.DB, item.id);
  const { itemId: _itemId, ...result } = shape;
  return result;
}

export async function addArc(
  env: Env,
  args: AddCommon & { start: Point; end: Point; bulge: number }
): Promise<Shape> {
  const page = await getPage(env.DB, args.project_id, args.page_index);
  const scale = parseScale(page);
  if (!scale.isSet) throw new Error(`Page ${args.page_index} scale is not calibrated.`);

  const pixelLen = calculateArcLength(args.start, args.end, args.bulge);
  const value = getScaledValue(pixelLen, scale.pixelsPerUnit);

  const item = await getOrCreateItem(env.DB, args.project_id, {
    id: args.item_id,
    label: args.name ?? 'Arc',
    type: ToolType.ARC,
    unit: scale.unit,
    color: args.color ?? '#8b5cf6',
  });

  const shape: Shape & { itemId: string } = {
    id: args.shape_id ?? crypto.randomUUID(),
    itemId: item.id,
    pageIndex: args.page_index,
    points: [args.start, args.end],
    bulges: [args.bulge],
    value,
    deduction: args.deduction,
  };
  await insertShape(env.DB, shape);
  await recalcItemTotal(env.DB, item.id);
  const { itemId: _itemId, ...result } = shape;
  return result;
}
