import type { Env } from '../env';
import type { TakeoffItem } from '@takeoff/shared';
import { recalcItemTotal, rowToShape, rowToTakeoffItem, ItemRow, ShapeRow } from '../db/queries';

export async function createItem(
  env: Env,
  args: {
    project_id: string;
    id?: string;
    label: string;
    type: string;
    color: string;
    unit: string;
    properties?: unknown;
    formula?: string;
    price?: number;
    group?: string;
    visible?: boolean;
    depth?: number;
    assembly_id?: string;
    sub_items?: unknown;
    hidden_pages?: number[];
  }
): Promise<TakeoffItem> {
  const id = args.id ?? crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO items
       (id, project_id, label, type, color, unit, total_value, group_name,
        properties_json, price, formula, sub_items_json, visible, depth,
        hidden_pages_json, assembly_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      args.project_id,
      args.label,
      args.type,
      args.color,
      args.unit,
      args.group ?? null,
      args.properties ? JSON.stringify(args.properties) : null,
      args.price ?? null,
      args.formula ?? null,
      args.sub_items ? JSON.stringify(args.sub_items) : null,
      args.visible === false ? 0 : 1,
      args.depth ?? null,
      args.hidden_pages ? JSON.stringify(args.hidden_pages) : null,
      args.assembly_id ?? null,
      now,
      now
    )
    .run();
  const row = (await env.DB.prepare('SELECT * FROM items WHERE id = ?')
    .bind(id)
    .first()) as ItemRow;
  return rowToTakeoffItem(row, []);
}

export async function updateItem(
  env: Env,
  itemId: string,
  patch: {
    label?: string;
    color?: string;
    unit?: string;
    properties?: unknown;
    formula?: string;
    price?: number | null;
    group?: string;
    visible?: boolean;
    depth?: number | null;
    assembly_id?: string | null;
    hidden_pages?: number[];
  }
): Promise<TakeoffItem> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.label !== undefined) { sets.push('label = ?'); binds.push(patch.label); }
  if (patch.color !== undefined) { sets.push('color = ?'); binds.push(patch.color); }
  if (patch.unit !== undefined) { sets.push('unit = ?'); binds.push(patch.unit); }
  if (patch.properties !== undefined) {
    sets.push('properties_json = ?');
    binds.push(JSON.stringify(patch.properties));
  }
  if (patch.formula !== undefined) { sets.push('formula = ?'); binds.push(patch.formula); }
  if (patch.price !== undefined) { sets.push('price = ?'); binds.push(patch.price); }
  if (patch.group !== undefined) { sets.push('group_name = ?'); binds.push(patch.group); }
  if (patch.visible !== undefined) { sets.push('visible = ?'); binds.push(patch.visible ? 1 : 0); }
  if (patch.depth !== undefined) { sets.push('depth = ?'); binds.push(patch.depth); }
  if (patch.assembly_id !== undefined) { sets.push('assembly_id = ?'); binds.push(patch.assembly_id); }
  if (patch.hidden_pages !== undefined) {
    sets.push('hidden_pages_json = ?');
    binds.push(JSON.stringify(patch.hidden_pages));
  }
  if (sets.length === 0) {
    const existing = (await env.DB.prepare('SELECT * FROM items WHERE id = ?')
      .bind(itemId)
      .first()) as ItemRow | null;
    if (!existing) throw new Error(`Item ${itemId} not found`);
    return rowToTakeoffItem(existing, []);
  }
  sets.push('updated_at = ?');
  binds.push(Date.now(), itemId);
  await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  const row = (await env.DB.prepare('SELECT * FROM items WHERE id = ?')
    .bind(itemId)
    .first()) as ItemRow | null;
  if (!row) throw new Error(`Item ${itemId} not found`);
  const shapes = await env.DB.prepare(
    'SELECT * FROM shapes WHERE item_id = ? ORDER BY created_at'
  )
    .bind(itemId)
    .all();
  return rowToTakeoffItem(row, (shapes.results as unknown as ShapeRow[]).map(rowToShape));
}

export async function deleteItem(env: Env, itemId: string): Promise<{ deleted: boolean }> {
  const res = await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(itemId).run();
  return { deleted: (res.meta?.changes ?? 0) > 0 };
}

export async function deleteShape(
  env: Env,
  shapeId: string
): Promise<{ deleted: boolean; item_id: string | null }> {
  const row = (await env.DB.prepare('SELECT item_id FROM shapes WHERE id = ?')
    .bind(shapeId)
    .first()) as { item_id: string } | null;
  if (!row) return { deleted: false, item_id: null };
  await env.DB.prepare('DELETE FROM shapes WHERE id = ?').bind(shapeId).run();
  await recalcItemTotal(env.DB, row.item_id);
  return { deleted: true, item_id: row.item_id };
}

export async function updateShape(
  env: Env,
  shapeId: string,
  patch: { points?: unknown; deduction?: boolean; value?: number }
): Promise<{ updated: boolean; item_id: string | null }> {
  const row = (await env.DB.prepare('SELECT item_id FROM shapes WHERE id = ?')
    .bind(shapeId)
    .first()) as { item_id: string } | null;
  if (!row) return { updated: false, item_id: null };
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.points !== undefined) { sets.push('points_json = ?'); binds.push(JSON.stringify(patch.points)); }
  if (patch.deduction !== undefined) { sets.push('deduction = ?'); binds.push(patch.deduction ? 1 : 0); }
  if (patch.value !== undefined) { sets.push('value = ?'); binds.push(patch.value); }
  if (sets.length === 0) return { updated: true, item_id: row.item_id };
  binds.push(shapeId);
  await env.DB.prepare(`UPDATE shapes SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  await recalcItemTotal(env.DB, row.item_id);
  return { updated: true, item_id: row.item_id };
}
