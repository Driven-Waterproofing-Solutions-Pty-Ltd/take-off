import type { Env } from '../env';
import { evaluateFormula, TakeoffItem, QuoteDraft, QuoteLineItem } from '@takeoff/shared';
import { rowToShape, rowToTakeoffItem, ItemRow, ShapeRow } from '../db/queries';

export async function listItems(env: Env, projectId: string): Promise<TakeoffItem[]> {
  const itemRows = (
    await env.DB.prepare('SELECT * FROM items WHERE project_id = ? ORDER BY created_at')
      .bind(projectId)
      .all()
  ).results as unknown as ItemRow[];

  if (itemRows.length === 0) return [];

  const shapeRows = (
    await env.DB.prepare(
      `SELECT * FROM shapes WHERE item_id IN (${itemRows.map(() => '?').join(',')})`
    )
      .bind(...itemRows.map((r) => r.id))
      .all()
  ).results as unknown as ShapeRow[];

  const byItem = new Map<string, ShapeRow[]>();
  for (const s of shapeRows) {
    const arr = byItem.get(s.item_id) ?? [];
    arr.push(s);
    byItem.set(s.item_id, arr);
  }

  return itemRows.map((row) =>
    rowToTakeoffItem(row, (byItem.get(row.id) ?? []).map(rowToShape))
  );
}

export async function searchProjects(
  env: Env,
  args: { query: string; limit?: number }
): Promise<
  Array<{
    project_id: string;
    name: string;
    customer_name?: string;
    total?: number;
    created_at: number;
    snippet?: string;
  }>
> {
  const q = `%${args.query}%`;
  const limit = args.limit ?? 10;
  // Pick the most-recent past_quote per project so each project shows up once.
  const rows = await env.DB.prepare(
    `SELECT p.id, p.name, c.name AS customer_name, latest_pq.total, p.created_at
     FROM projects p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN (
       SELECT pq.project_id, pq.total
       FROM past_quotes pq
       JOIN (
         SELECT project_id, MAX(created_at) AS max_created
         FROM past_quotes GROUP BY project_id
       ) m ON m.project_id = pq.project_id AND m.max_created = pq.created_at
     ) latest_pq ON latest_pq.project_id = p.id
     WHERE p.name LIKE ? OR c.name LIKE ?
     GROUP BY p.id
     ORDER BY p.created_at DESC
     LIMIT ?`
  )
    .bind(q, q, limit)
    .all();
  return rows.results.map((r) => ({
    project_id: r.id as string,
    name: r.name as string,
    customer_name: (r.customer_name as string) ?? undefined,
    total: (r.total as number) ?? undefined,
    created_at: r.created_at as number,
  }));
}

export async function recallCustomer(
  env: Env,
  args: { query: string }
): Promise<
  Array<{
    id: string;
    xeroContactId?: string;
    name: string;
    email?: string;
    phone?: string;
  }>
> {
  const q = `%${args.query}%`;
  const rows = await env.DB.prepare(
    `SELECT id, xero_contact_id, name, email, phone FROM customers
     WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?
     ORDER BY name LIMIT 20`
  )
    .bind(q, q, q)
    .all();
  return rows.results.map((r) => ({
    id: r.id as string,
    xeroContactId: (r.xero_contact_id as string) ?? undefined,
    name: r.name as string,
    email: (r.email as string) ?? undefined,
    phone: (r.phone as string) ?? undefined,
  }));
}

export async function listAssemblies(
  env: Env,
  args: { tag?: string }
): Promise<Array<{ id: string; name: string; unit: string; tags?: string[] }>> {
  const rows = await env.DB.prepare('SELECT id, name, unit, tags_json FROM assemblies ORDER BY name').all();
  return rows.results
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      unit: r.unit as string,
      tags: r.tags_json ? (JSON.parse(r.tags_json as string) as string[]) : undefined,
    }))
    .filter((a) => (args.tag ? a.tags?.includes(args.tag) : true));
}

export async function applyAssembly(
  env: Env,
  args: { project_id: string; item_id: string; assembly_id: string }
): Promise<TakeoffItem> {
  // Validate the assembly exists before attaching it. Without this check, a
  // typoed or deleted assembly_id would silently land on the item, and
  // buildQuote would skip it (no material lines, no priced-item fallback),
  // making the item disappear from generated quotes.
  const exists = await env.DB.prepare('SELECT 1 FROM assemblies WHERE id = ?')
    .bind(args.assembly_id)
    .first();
  if (!exists) throw new Error(`Assembly ${args.assembly_id} not found`);

  const res = await env.DB.prepare(
    'UPDATE items SET assembly_id = ?, updated_at = ? WHERE id = ? AND project_id = ?'
  )
    .bind(args.assembly_id, Date.now(), args.item_id, args.project_id)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    throw new Error(`Item ${args.item_id} not found in project ${args.project_id}`);
  }

  const items = await listItems(env, args.project_id);
  const item = items.find((i) => i.id === args.item_id);
  if (!item) throw new Error(`Item ${args.item_id} not found`);
  return item;
}

export async function buildQuote(env: Env, projectId: string): Promise<QuoteDraft> {
  const items = await listItems(env, projectId);
  const project = (await env.DB.prepare(
    'SELECT customer_id FROM projects WHERE id = ?'
  )
    .bind(projectId)
    .first()) as { customer_id: string | null } | null;

  // Default labour charge-out (used when assembly_lines specify minutes per unit
  // but no specific labour_rate is set on the assembly).
  const labourRow = (await env.DB.prepare(
    'SELECT charge_out_rate FROM labour_rates ORDER BY id LIMIT 1'
  ).first()) as { charge_out_rate: number } | null;
  const defaultChargeOutPerHour = labourRow?.charge_out_rate ?? 0;

  const lines: QuoteLineItem[] = [];

  for (const item of items) {
    if (item.assemblyId) {
      const assembly = (await env.DB.prepare(
        'SELECT id, name, unit, formula FROM assemblies WHERE id = ?'
      )
        .bind(item.assemblyId)
        .first()) as { id: string; name: string; unit: string; formula: string | null } | null;

      const linesRes = await env.DB.prepare(
        `SELECT al.qty_per_unit, al.waste_pct, al.labour_min_per_unit,
                m.id AS material_id, m.name AS material_name, m.unit AS material_unit, m.unit_cost
         FROM assembly_lines al
         JOIN materials m ON m.id = al.material_id
         WHERE al.assembly_id = ?`
      )
        .bind(item.assemblyId)
        .all();

      const qty = evaluateFormula(item, item.totalValue, assembly?.formula ?? undefined);

      let assemblyLabourMinutes = 0;
      for (const r of linesRes.results as unknown as Array<{
        qty_per_unit: number;
        waste_pct: number;
        labour_min_per_unit: number;
        material_id: string;
        material_name: string;
        material_unit: string;
        unit_cost: number;
      }>) {
        const totalQty = qty * r.qty_per_unit * (1 + r.waste_pct / 100);
        lines.push({
          description: `${assembly?.name ?? 'Assembly'} — ${r.material_name}`,
          qty: totalQty,
          unit: r.material_unit,
          unitPrice: r.unit_cost,
          lineTotal: totalQty * r.unit_cost,
          assemblyId: item.assemblyId,
          itemId: item.id,
        });
        assemblyLabourMinutes += qty * r.labour_min_per_unit;
      }

      if (assemblyLabourMinutes > 0 && defaultChargeOutPerHour > 0) {
        const labourHours = assemblyLabourMinutes / 60;
        lines.push({
          description: `${assembly?.name ?? 'Assembly'} — labour`,
          qty: labourHours,
          unit: 'hrs',
          unitPrice: defaultChargeOutPerHour,
          lineTotal: labourHours * defaultChargeOutPerHour,
          assemblyId: item.assemblyId,
          itemId: item.id,
        });
      }
    } else if (item.price !== undefined) {
      const qty = evaluateFormula(item);
      lines.push({
        description: item.label,
        qty,
        unit: item.unit,
        unitPrice: item.price,
        lineTotal: qty * item.price,
        itemId: item.id,
      });
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const gst = subtotal * 0.1;
  const total = subtotal + gst;

  return {
    projectId,
    customerId: project?.customer_id ?? undefined,
    lines,
    subtotal,
    gst,
    total,
  };
}
