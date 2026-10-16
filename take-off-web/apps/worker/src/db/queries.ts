import type { D1Database } from '@cloudflare/workers-types';
import { ToolType, getLinearBase } from '@takeoff/shared';
import type {
  Shape,
  TakeoffItem,
  ScaleCalibration,
  Unit,
} from '@takeoff/shared';

export interface ProjectRow {
  id: string;
  name: string;
  customer_id: string | null;
  meta_json: string;
  created_at: number;
  updated_at: number;
  snoozed_until?: number | null;
}

export interface PageRow {
  project_id: string;
  page_index: number;
  scale_json: string;
  vector_cache_json: string | null;
  name: string | null;
  legend_json: string | null;
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

// Write only the page columns this call supplies, in ONE statement. The
// previous read-modify-write SELECTed the row and then rewrote every column,
// so two overlapping writers (e.g. a vector-cache upload racing a
// calibration) could each restore the other's stale value — a successful
// calibration could reload as unset. With INSERT … ON CONFLICT DO UPDATE SET
// <supplied columns only>, untouched columns are never rewritten.
export async function upsertPage(
  db: D1Database,
  projectId: string,
  pageIndex: number,
  fields: Partial<{
    scale: ScaleCalibration;
    vectorCache: unknown;
    name: string;
    legend: unknown;
  }>
): Promise<PageRow> {
  const supplied: Array<[column: string, value: string]> = [];
  if (fields.scale !== undefined) supplied.push(['scale_json', JSON.stringify(fields.scale)]);
  if (fields.vectorCache !== undefined) {
    supplied.push(['vector_cache_json', JSON.stringify(fields.vectorCache)]);
  }
  if (fields.name !== undefined) supplied.push(['name', fields.name]);
  if (fields.legend !== undefined) supplied.push(['legend_json', JSON.stringify(fields.legend)]);

  const value = (column: string): string | null =>
    supplied.find(([c]) => c === column)?.[1] ?? null;
  const updates = supplied.map(([column]) => `${column} = excluded.${column}`);
  await db
    .prepare(
      `INSERT INTO pages (project_id, page_index, scale_json, vector_cache_json, name, legend_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, page_index) DO ${
         updates.length > 0 ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'
       }`
    )
    .bind(
      projectId,
      pageIndex,
      value('scale_json') ?? '{"isSet":false,"pixelsPerUnit":0,"unit":"m"}',
      value('vector_cache_json'),
      value('name'),
      value('legend_json')
    )
    .run();
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

// Create-or-replace a shape by its client-supplied id, then recompute the
// owning item's total (and the previous owner's, if the retry moved it).
//
// Idempotent across useShapeSync retries: the hook supplies client-side UUIDs
// and only snapshots a shape as "synced" on a successful POST. If the first
// POST committed but its response was lost, the retry arrives with the same
// id — possibly carrying NEWER points / value / item_id because the user kept
// editing in between. An upsert lands that latest payload; the previous
// INSERT OR IGNORE kept the stale first row while the hook snapshotted the
// newer local shape as synced, so the server never got repaired.
//
// A shape id that already belongs to another project's item is refused, so a
// caller can't use the create path to pull a foreign shape into its project.
export async function persistShape(
  db: D1Database,
  shape: Shape & { itemId: string }
): Promise<void> {
  const existing = (await db
    .prepare(
      `SELECT s.item_id, i.project_id FROM shapes s
         JOIN items i ON i.id = s.item_id
        WHERE s.id = ?`
    )
    .bind(shape.id)
    .first()) as { item_id: string; project_id: string } | null;
  if (existing && existing.item_id !== shape.itemId) {
    const target = (await db
      .prepare('SELECT project_id FROM items WHERE id = ?')
      .bind(shape.itemId)
      .first()) as { project_id: string } | null;
    if (!target || target.project_id !== existing.project_id) {
      throw new Error(`Shape ${shape.id} already exists in a different project`);
    }
  }
  await db
    .prepare(
      `INSERT INTO shapes (id, item_id, page_index, points_json, bulges_json, value, deduction, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         item_id = excluded.item_id,
         page_index = excluded.page_index,
         points_json = excluded.points_json,
         bulges_json = excluded.bulges_json,
         value = excluded.value,
         deduction = excluded.deduction,
         text = excluded.text`
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
  await recalcItemTotal(db, shape.itemId);
  if (existing && existing.item_id !== shape.itemId) {
    await recalcItemTotal(db, existing.item_id);
  }
}

// Measurement families that share a value unit and can land shapes on the
// same item without re-labeling totals/quotes:
//   AREA/FILL/VOLUME            -> polygon area (VOLUME folds in item.depth)
//   LINEAR/SEGMENT/DIMENSION/ARC-> linear length (ARC shares the family
//     because multi-vertex arcs are stored as straight-chord polylines and
//     persisted through the LINEAR endpoint — see useShapeSync's create
//     branch. Single-segment bulged arcs still go through /shapes/arc.)
//   COUNT, NOTE                 -> distinct families of their own
// Mixing families silently labels e.g. an area-valued polygon as metres,
// so refuse to reuse an existing row whose type is in a different family.
export function itemFamily(type: ToolType): string {
  switch (type) {
    case ToolType.AREA:
    case ToolType.FILL:
    case ToolType.VOLUME:
      return 'area';
    case ToolType.LINEAR:
    case ToolType.SEGMENT:
    case ToolType.DIMENSION:
    case ToolType.ARC:
      return 'linear';
    case ToolType.COUNT:
      return 'count';
    case ToolType.NOTE:
      return 'note';
    default:
      return 'unknown';
  }
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
    if (existing) {
      const existingFamily = itemFamily(existing.type as ToolType);
      const requestedFamily = itemFamily(hint.type);
      if (existingFamily !== requestedFamily) {
        throw new Error(
          `Item ${hint.id} is ${existing.type} (${existingFamily}-family); a ${hint.type} shape (${requestedFamily}-family) can't land on it — totals/quotes would label the value with the wrong unit.`
        );
      }
      // Compare linear bases so AREA shapes can land on VOLUME items
      // (both derive from the same linear unit) while a "sq m" item still
      // rejects a "sq ft" shape from a differently-calibrated page.
      // Unit values are SPACE-separated ("sq ft", "cu m") — getLinearBase
      // handles the space prefix plus the acres/hectares special cases.
      if (getLinearBase(existing.unit) !== getLinearBase(hint.unit)) {
        throw new Error(
          `Item ${hint.id} has unit "${existing.unit}"; the destination page measures in "${hint.unit}" (different linear base). Recalibrate the page or use a separate item — mixing units silently corrupts totals.`
        );
      }
      return existing;
    }
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
  const type = row.type as ToolType;
  const depth = row.depth ?? undefined;
  // total_value stores the raw shape-sum (polygon area for VOLUME). The canvas
  // treats item.totalValue as the FINAL quantity though — area×depth for
  // VOLUME items — so hydrate that final number here. Without this, after a
  // cloud reload the Estimates/Properties UI would show the area number
  // labeled as cubic and underprice the item until the user edits a shape.
  const totalValue =
    type === ToolType.VOLUME && depth != null ? row.total_value * depth : row.total_value;
  return {
    id: row.id,
    label: row.label,
    type,
    color: row.color,
    unit: row.unit as Unit,
    shapes,
    totalValue,
    group: row.group_name ?? undefined,
    properties: row.properties_json ? JSON.parse(row.properties_json) : undefined,
    price: row.price ?? undefined,
    formula: row.formula ?? undefined,
    subItems: row.sub_items_json ? JSON.parse(row.sub_items_json) : undefined,
    visible: row.visible === 1,
    hiddenPages: row.hidden_pages_json ? JSON.parse(row.hidden_pages_json) : undefined,
    depth,
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
