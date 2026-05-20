import type { D1Database } from '@cloudflare/workers-types';
import type {
  Shape,
  TakeoffItem,
  ScaleCalibration,
  Unit,
  ToolType,
} from '@takeoff/shared';

export interface ProjectRow {
  id: string;
  name: string;
  customer_id: string | null;
  meta_json: string;
  created_at: number;
  updated_at: number;
}

export interface PageRow {
  project_id: string;
  page_index: number;
  scale_json: string;
  vector_cache_json: string | null;
  name: string | null;
}

export interface ItemRow {
  id: string;
  project_id: string;
  label: string;
  type: string;
  color: string;
  unit: string;
  total_value: number;
  group_name: string | null;
  properties_json: string | null;
  price: number | null;
  formula: string | null;
  sub_items_json: string | null;
  visible: number;
  hidden_pages_json: string | null;
  depth: number | null;
  assembly_id: string | null;
}

export interface ShapeRow {
  id: string;
  item_id: string;
  page_index: number;
  points_json: string;
  bulges_json: string | null;
  value: number;
  deduction: number;
  text: string | null;
}

export async function getProject(db: D1Database, projectId: string): Promise<ProjectRow | null> {
  return (await db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first()) as ProjectRow | null;
}

export async function upsertPage(
  db: D1Database,
  projectId: string,
  pageIndex: number,
  fields: Partial<{ scale: ScaleCalibration; vectorCache: unknown; name: string }>
): Promise<PageRow> {
  const existing = await getPage(db, projectId, pageIndex);
  const scale_json = fields.scale ? JSON.stringify(fields.scale) : existing?.scale_json ?? null;
  const vector_cache_json =
    fields.vectorCache !== undefined
      ? JSON.stringify(fields.vectorCache)
      : existing?.vector_cache_json ?? null;
  const name = fields.name ?? existing?.name ?? null;

  if (existing) {
    await db
      .prepare(
        `UPDATE pages SET scale_json = COALESCE(?, scale_json),
                          vector_cache_json = ?,
                          name = ?
         WHERE project_id = ? AND page_index = ?`
      )
      .bind(scale_json, vector_cache_json, name, projectId, pageIndex)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO pages (project_id, page_index, scale_json, vector_cache_json, name)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        projectId,
        pageIndex,
        scale_json ?? '{"isSet":false,"pixelsPerUnit":0,"unit":"m"}',
        vector_cache_json,
        name
      )
      .run();
  }
  return (await getPage(db, projectId, pageIndex))!;
}

export async function getPage(
  db: D1Database,
  projectId: string,
  pageIndex: number
): Promise<PageRow | null> {
  return (await db
    .prepare('SELECT * FROM pages WHERE project_id = ? AND page_index = ?')
    .bind(projectId, pageIndex)
    .first()) as PageRow | null;
}

export function parseScale(row: PageRow | null): ScaleCalibration {
  if (!row) return { isSet: false, pixelsPerUnit: 0, unit: 'm' as Unit };
  return JSON.parse(row.scale_json) as ScaleCalibration;
}

export async function insertShape(
  db: D1Database,
  shape: Shape & { itemId: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO shapes (id, item_id, page_index, points_json, bulges_json, value, deduction, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      shape.id,
      shape.itemId,
      shape.pageIndex,
      JSON.stringify(shape.points),
      shape.bulges ? JSON.stringify(shape.bulges) : null,
      shape.value,
      shape.deduction ? 1 : 0,
      shape.text ?? null,
      Date.now()
    )
    .run();
}

export async function getOrCreateItem(
  db: D1Database,
  projectId: string,
  hint: { id?: string; label?: string; type: ToolType; unit: string; color: string }
): Promise<ItemRow> {
  if (hint.id) {
    const existing = (await db
      .prepare('SELECT * FROM items WHERE id = ? AND project_id = ?')
      .bind(hint.id, projectId)
      .first()) as ItemRow | null;
    if (existing) return existing;
  }
  const id = hint.id ?? crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO items (id, project_id, label, type, color, unit, total_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(
      id,
      projectId,
      hint.label ?? `${hint.type} item`,
      hint.type,
      hint.color,
      hint.unit,
      now,
      now
    )
    .run();
  return (await db
    .prepare('SELECT * FROM items WHERE id = ?')
    .bind(id)
    .first()) as ItemRow;
}

export async function recalcItemTotal(db: D1Database, itemId: string): Promise<number> {
  const result = (await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN deduction = 1 THEN -value ELSE value END), 0) AS total
       FROM shapes WHERE item_id = ?`
    )
    .bind(itemId)
    .first()) as { total: number } | null;
  const total = result?.total ?? 0;
  await db
    .prepare('UPDATE items SET total_value = ?, updated_at = ? WHERE id = ?')
    .bind(total, Date.now(), itemId)
    .run();
  return total;
}

export function rowToTakeoffItem(row: ItemRow, shapes: Shape[]): TakeoffItem {
  return {
    id: row.id,
    label: row.label,
    type: row.type as ToolType,
    color: row.color,
    unit: row.unit as Unit,
    shapes,
    totalValue: row.total_value,
    group: row.group_name ?? undefined,
    properties: row.properties_json ? JSON.parse(row.properties_json) : undefined,
    price: row.price ?? undefined,
    formula: row.formula ?? undefined,
    subItems: row.sub_items_json ? JSON.parse(row.sub_items_json) : undefined,
    visible: row.visible === 1,
    hiddenPages: row.hidden_pages_json ? JSON.parse(row.hidden_pages_json) : undefined,
    depth: row.depth ?? undefined,
    assemblyId: row.assembly_id ?? undefined,
  };
}

export function rowToShape(row: ShapeRow): Shape {
  return {
    id: row.id,
    pageIndex: row.page_index,
    points: JSON.parse(row.points_json),
    bulges: row.bulges_json ? JSON.parse(row.bulges_json) : undefined,
    value: row.value,
    deduction: row.deduction === 1,
    text: row.text ?? undefined,
  };
}
