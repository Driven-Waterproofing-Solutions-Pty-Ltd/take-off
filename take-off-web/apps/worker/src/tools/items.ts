import type { Env } from '../env';
import { type TakeoffItem, ToolType } from '@takeoff/shared';
import {
  itemFamily,
  recalcItemTotal,
  rowToShape,
  rowToTakeoffItem,
  ItemRow,
  ShapeRow,
} from '../db/queries';

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
  // Idempotent on client-supplied id: if useShapeSync retries after a network
  // failure (where the original INSERT may have committed but the response was
  // lost), the second call must not throw a PK constraint — that would block
  // the retry loop forever and strand the item's child shapes. INSERT OR
  // IGNORE means a duplicate id is a no-op; the follow-up SELECT returns the
  // row that's already there. We still defend against cross-project id reuse
  // by scoping the lookup to (id, project_id) and treating a mismatch as an
  // error (UUID collisions across projects are statistically impossible —
  // this guards against malicious or buggy callers).
  const existing = (await env.DB.prepare(
    'SELECT project_id FROM items WHERE id = ?'
  )
    .bind(id)
    .first()) as { project_id: string } | null;
  if (existing && existing.project_id !== args.project_id) {
    throw new Error(`Item ${id} already exists in a different project`);
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO items
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
    sub_items?: unknown;
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
  if (patch.sub_items !== undefined) {
    sets.push('sub_items_json = ?');
    binds.push(JSON.stringify(patch.sub_items));
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
  patch: {
    points?: unknown;
    deduction?: boolean;
    value?: number;
    item_id?: string;
    text?: string;
  }
): Promise<{ updated: boolean; item_id: string | null; previous_item_id?: string }> {
  const row = (await env.DB.prepare(
    `SELECT s.item_id, i.project_id FROM shapes s
       JOIN items i ON i.id = s.item_id
      WHERE s.id = ?`
  )
    .bind(shapeId)
    .first()) as { item_id: string; project_id: string } | null;
  if (!row) return { updated: false, item_id: null };
  const previousItemId = row.item_id;
  const projectId = row.project_id;
  // Cross-project reparent is a real authz hole — without this check, any
  // authenticated caller who knows a shape id + an item id from a different
  // project can hijack the shape into that project (and silently change both
  // items' totals). Restrict reparent targets to the SAME project.
  if (patch.item_id !== undefined && patch.item_id !== previousItemId) {
    const target = (await env.DB.prepare(
      'SELECT project_id, type, unit FROM items WHERE id = ?'
    )
      .bind(patch.item_id)
      .first()) as { project_id: string; type: string; unit: string } | null;
    if (!target) throw new Error(`Target item ${patch.item_id} not found`);
    if (target.project_id !== projectId) {
      throw new Error('Cannot move shape into an item from a different project');
    }
    // Family + unit compatibility, same rule as getOrCreateItem. Without it
    // a REST/MCP caller could move an area polygon or a metre line into a
    // count item or a feet item; recalcItemTotal then sums the raw value
    // under the wrong type/unit and quietly corrupts legends/quotes.
    const source = (await env.DB.prepare(
      'SELECT type, unit FROM items WHERE id = ?'
    )
      .bind(previousItemId)
      .first()) as { type: string; unit: string } | null;
    if (source) {
      const sourceFamily = itemFamily(source.type as ToolType);
      const targetFamily = itemFamily(target.type as ToolType);
      if (sourceFamily !== targetFamily) {
        throw new Error(
          `Cannot move shape into ${target.type} item — it's in the ${targetFamily}-family but the shape lives in a ${sourceFamily}-family item; totals/quotes would label the value with the wrong unit.`
        );
      }
      if (source.unit !== target.unit) {
        throw new Error(
          `Cannot move shape into item with unit "${target.unit}" — shape is measured in "${source.unit}". Use a same-unit target or recalibrate first.`
        );
      }
    }
  }
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.points !== undefined) { sets.push('points_json = ?'); binds.push(JSON.stringify(patch.points)); }
  if (patch.deduction !== undefined) { sets.push('deduction = ?'); binds.push(patch.deduction ? 1 : 0); }
  if (patch.value !== undefined) { sets.push('value = ?'); binds.push(patch.value); }
  if (patch.text !== undefined) { sets.push('text = ?'); binds.push(patch.text); }
  if (patch.item_id !== undefined && patch.item_id !== previousItemId) {
    sets.push('item_id = ?');
    binds.push(patch.item_id);
  }
  if (sets.length === 0) return { updated: true, item_id: previousItemId };
  binds.push(shapeId);
  await env.DB.prepare(`UPDATE shapes SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  const newItemId = patch.item_id ?? previousItemId;
  await recalcItemTotal(env.DB, newItemId);
  // On reparent, the old item's total must also be recomputed.
  if (newItemId !== previousItemId) {
    await recalcItemTotal(env.DB, previousItemId);
  }
  return {
    updated: true,
    item_id: newItemId,
    previous_item_id: newItemId !== previousItemId ? previousItemId : undefined,
  };
}
