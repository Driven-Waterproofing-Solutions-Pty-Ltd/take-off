import type { Env } from '../env';
import {
  evaluateFormula,
  tryEvaluateFormula,
  TakeoffItem,
  QuoteDraft,
  QuoteLineItem,
  toVariableName,
  Unit,
} from '@takeoff/shared';

// VOLUME depth is folded into item.totalValue by rowToTakeoffItem on hydration.
// buildQuote uses totalValue directly — no per-type fold needed here.
import { rowToShape, rowToTakeoffItem, ItemRow, ShapeRow } from '../db/queries';
import { sha256Hex } from '../lib/crypto';

// Stable identity of a priced quote: what would be sent to Xero, rounded so
// floating-point noise can't change it. Used to make sure the quote a user
// (or agent) reviewed is the one that gets pushed.
export async function quoteFingerprint(quote: Pick<QuoteDraft, 'projectId' | 'lines' | 'total'>): Promise<string> {
  const stable = {
    p: quote.projectId,
    t: Math.round(quote.total * 100),
    l: quote.lines.map((l) => [
      l.description,
      Math.round(l.qty * 1000),
      l.unit,
      Math.round(l.unitPrice * 100),
      Math.round(l.lineTotal * 100),
    ]),
  };
  return (await sha256Hex(JSON.stringify(stable))).slice(0, 32);
}

export async function listItems(env: Env, projectId: string): Promise<TakeoffItem[]> {
  const itemRows = (
    await env.DB.prepare('SELECT * FROM items WHERE project_id = ? ORDER BY created_at')
      .bind(projectId)
      .all()
  ).results as unknown as ItemRow[];

  if (itemRows.length === 0) return [];

  // Join instead of `item_id IN (?, ?, …)`: D1 caps a statement at 100 bound
  // parameters, so a project with more than 100 items could no longer be
  // hydrated or quoted.
  const shapeRows = (
    await env.DB.prepare(
      `SELECT s.* FROM shapes s
         JOIN items i ON i.id = s.item_id
        WHERE i.project_id = ?`
    )
      .bind(projectId)
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
  // Filter to the currently-active Xero tenant so a tenant switch can't
  // surface stale contacts (which would push DRAFT quotes to ContactIDs
  // the active OAuth token doesn't own). Customers with no
  // xero_tenant_id (e.g. manually-created rows or pre-tenant-scoping
  // seed data) stay visible.
  const activeTenant = (await env.DB.prepare(
    'SELECT tenant_id FROM xero_tokens ORDER BY updated_at DESC LIMIT 1'
  ).first()) as { tenant_id: string } | null;
  const tenant = activeTenant?.tenant_id ?? null;
  const rows = await env.DB.prepare(
    `SELECT id, xero_contact_id, name, email, phone FROM customers
     WHERE (name LIKE ? OR email LIKE ? OR phone LIKE ?)
       AND (xero_tenant_id IS NULL OR xero_tenant_id = ?)
     ORDER BY name LIMIT 20`
  )
    .bind(q, q, q, tenant)
    .all();
  return rows.results.map((r) => ({
    id: r.id as string,
    xeroContactId: (r.xero_contact_id as string) ?? undefined,
    name: r.name as string,
    email: (r.email as string) ?? undefined,
    phone: (r.phone as string) ?? undefined,
  }));
}

export async function getTakeoffKnowledge(
  env: Env,
  args: { topic?: string; builder?: string }
): Promise<
  Array<{ id: string; topic: string; title: string; body_md: string; builder: string | null }>
> {
  // Topic-tagged markdown chunks the agent pulls at run time so the
  // skill / methodology / rate cards / FFE conventions stop being
  // Claude-Code-only and become first-class knowledge for the deployed
  // in-app agent + every MCP client. Filters are AND-combined; omit both
  // for the full index. Order by topic + title to keep ranking stable
  // across runs (the agent typically reads top-down).
  const where: string[] = [];
  const binds: unknown[] = [];
  if (args.topic) {
    where.push('topic = ?');
    binds.push(args.topic);
  }
  if (args.builder) {
    where.push('builder = ?');
    binds.push(args.builder);
  }
  const sql =
    `SELECT id, topic, title, body_md, builder FROM takeoff_knowledge` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY topic, title`;
  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return rows.results.map((r) => ({
    id: r.id as string,
    topic: r.topic as string,
    title: r.title as string,
    body_md: r.body_md as string,
    builder: (r.builder as string | null) ?? null,
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

// Canonical form of a quantity unit, or null when it isn't a measurement
// unit we can reason about (material units like "Rolls", free-text units).
// Assembly units are admin-entered free text, so accept the common spellings
// of the measurement units the canvas produces.
const UNIT_ALIASES: Record<string, string> = {
  m2: 'sq m', 'm²': 'sq m', sqm: 'sq m', 'sq.m': 'sq m',
  m3: 'cu m', 'm³': 'cu m', cum: 'cu m',
  lm: 'm', 'lin m': 'm', 'l/m': 'm',
  ft2: 'sq ft', 'ft²': 'sq ft', sqft: 'sq ft',
  ft3: 'cu ft', 'ft³': 'cu ft',
  lf: 'ft', 'lin ft': 'ft',
  ea: 'EA', each: 'EA', no: 'EA', 'no.': 'EA', item: 'EA', items: 'EA',
};
const MEASUREMENT_UNITS = new Set<string>([
  Unit.FEET, Unit.INCHES, Unit.YARDS, Unit.MILES,
  Unit.METERS, Unit.CENTIMETERS, Unit.MILLIMETERS, Unit.KILOMETERS,
  Unit.SQ_FT, Unit.SQ_IN, Unit.SQ_YD, Unit.SQ_MI, Unit.ACRES,
  Unit.SQ_M, Unit.SQ_CM, Unit.SQ_MM, Unit.SQ_KM, Unit.HECTARES,
  Unit.CU_FT, Unit.CU_IN, Unit.CU_YD, Unit.CU_MI,
  Unit.CU_M, Unit.CU_CM, Unit.CU_MM, Unit.CU_KM,
  Unit.EACH,
]);
export function canonicalMeasurementUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const trimmed = unit.trim();
  const aliased = UNIT_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  return MEASUREMENT_UNITS.has(aliased) ? aliased : null;
}

// Gate every path that stamps assembly_id onto an item (apply_assembly, raw
// item create/update). buildQuote treats any truthy assemblyId as
// authoritative — it emits the assembly's material/labour lines and skips the
// item's own price/sub-item fallback — and multiplies assembly quantities by
// the item's raw quantity. So:
//   * a missing assembly makes the item vanish from the quote, and
//   * a "sq m" assembly on a linear "m" (or "sq ft") item silently prices the
//     wrong dimension.
// Both are refused here. When either unit is free text we can't classify, the
// attach is allowed (we can't prove a mismatch).
export async function assertAssemblyAttachable(
  env: Env,
  assemblyId: string,
  itemUnit: string
): Promise<void> {
  const assembly = (await env.DB.prepare('SELECT unit FROM assemblies WHERE id = ?')
    .bind(assemblyId)
    .first()) as { unit: string } | null;
  if (!assembly) throw new Error(`Assembly ${assemblyId} not found`);
  const assemblyUnit = canonicalMeasurementUnit(assembly.unit);
  const measuredUnit = canonicalMeasurementUnit(itemUnit);
  if (assemblyUnit && measuredUnit && assemblyUnit !== measuredUnit) {
    throw new Error(
      `Assembly ${assemblyId} is priced per "${assembly.unit}" but the item is measured in "${itemUnit}" — cannot attach it without the quote pricing the wrong dimension.`
    );
  }
}

export async function applyAssembly(
  env: Env,
  args: { project_id: string; item_id: string; assembly_id: string }
): Promise<TakeoffItem> {
  const target = (await env.DB.prepare(
    'SELECT unit FROM items WHERE id = ? AND project_id = ?'
  )
    .bind(args.item_id, args.project_id)
    .first()) as { unit: string } | null;
  if (!target) throw new Error(`Item ${args.item_id} not found in project ${args.project_id}`);
  await assertAssemblyAttachable(env, args.assembly_id, target.unit);

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

  // Load every assembly (and its priced lines) referenced by this project's
  // items in two queries up front. Querying per assembly-linked item cost two
  // D1 queries each, so a project with a couple of dozen assembly items blew
  // D1's per-invocation query limit (50 on Workers Free) and build_quote /
  // the Xero push failed.
  type AssemblyLine = {
    assembly_id: string;
    qty_per_unit: number;
    waste_pct: number;
    labour_min_per_unit: number;
    material_id: string;
    material_name: string;
    material_unit: string;
    unit_cost: number;
  };
  const assemblyById = new Map<string, { id: string; name: string; unit: string; formula: string | null }>();
  const linesByAssembly = new Map<string, AssemblyLine[]>();
  if (items.some((i) => i.assemblyId)) {
    const assemblyRows = (
      await env.DB.prepare(
        `SELECT id, name, unit, formula FROM assemblies
          WHERE id IN (SELECT assembly_id FROM items WHERE project_id = ? AND assembly_id IS NOT NULL)`
      )
        .bind(projectId)
        .all()
    ).results as Array<{ id: string; name: string; unit: string; formula: string | null }>;
    for (const a of assemblyRows) assemblyById.set(a.id, a);
    const lineRows = (
      await env.DB.prepare(
        `SELECT al.assembly_id, al.qty_per_unit, al.waste_pct, al.labour_min_per_unit,
                m.id AS material_id, m.name AS material_name, m.unit AS material_unit, m.unit_cost
           FROM assembly_lines al
           JOIN materials m ON m.id = al.material_id
          WHERE al.assembly_id IN (SELECT assembly_id FROM items WHERE project_id = ? AND assembly_id IS NOT NULL)`
      )
        .bind(projectId)
        .all()
    ).results as unknown as AssemblyLine[];
    for (const l of lineRows) {
      const list = linesByAssembly.get(l.assembly_id) ?? [];
      list.push(l);
      linesByAssembly.set(l.assembly_id, list);
    }
  }

  const lines: QuoteLineItem[] = [];

  for (const item of items) {
    if (item.assemblyId) {
      const assembly = assemblyById.get(item.assemblyId) ?? null;
      const assemblyLines = linesByAssembly.get(item.assemblyId) ?? [];

      // An assembly formula that can't produce a finite quantity (syntax
      // error, unknown variable, divide by zero) must not price the
      // assembly at qty 0: that yields a valid-looking, fingerprinted quote
      // that silently omits the assembly's cost. Refuse the quote instead.
      const formulaOverride = assembly?.formula ?? undefined;
      const assemblyFormula = formulaOverride?.trim() ? formulaOverride : undefined;
      const evaluated = tryEvaluateFormula(item, item.totalValue, formulaOverride);
      if (assemblyFormula && !evaluated.ok) {
        throw new Error(
          `Cannot build the quote: assembly "${assembly?.name ?? item.assemblyId}" has a formula ("${assemblyFormula}") that ${
            evaluated.reason === 'error' ? 'fails to evaluate' : 'does not give a finite quantity'
          } for item "${item.label}". Fix the assembly formula first.`
        );
      }
      const qty = evaluated.ok ? evaluated.value : evaluateFormula(item, item.totalValue, formulaOverride);

      let assemblyLabourMinutes = 0;
      for (const r of assemblyLines) {
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
    } else if (item.price) {
      // Truthy check (not !== undefined) so price 0 is treated as "unpriced"
      // and the sub-items below become the line items — matching the canvas
      // Estimates view, which uses sub-items whenever the parent price is 0.
      const qty = evaluateFormula(item, item.totalValue);
      lines.push({
        description: item.label,
        qty,
        unit: item.unit,
        unitPrice: item.price,
        lineTotal: qty * item.price,
        itemId: item.id,
      });
    }

    // Sub-items: the Properties/Estimates UI lets users break an item down
    // into material/labour sub-lines, each with its own formula and price.
    // Two cases:
    //   (a) parent price is unset AND no assembly linked: sub-items ARE the
    //       line items — emit each.
    //   (b) parent has an assembly OR a price (both emit lines above): the
    //       in-app Estimates view treats sub-items as informational only and
    //       does NOT add their lineTotals to the project total. Match that
    //       behaviour server-side, otherwise quotes would double-charge —
    //       once for the assembly's material/labour breakdown and again for
    //       each sub-item line that was pre-templated on the item.
    const parentEmitsLines = !!item.assemblyId || !!item.price;
    if (!parentEmitsLines && item.subItems && item.subItems.length > 0) {
      // Mirror the canvas Estimates view: each sub-item formula can reference
      // every PRIOR sub-item by its variable-safe label. Without this context
      // a chain like `Membrane = Qty`, `Adhesive = Membrane * 0.2` would
      // evaluate Adhesive with Membrane unset, fall back to 0 / Qty, and
      // diverge from what the user sees on screen.
      const subContext: Record<string, number> = {};
      for (const sub of item.subItems) {
        // Same rule as the assembly formula above: a sub-item formula that
        // can't produce a finite quantity must not price its line (or any
        // later sub-item that references it) at 0 — that yields a
        // valid-looking quote with part of the item's cost missing.
        if (sub.formula?.trim()) {
          const evaluated = tryEvaluateFormula(item, item.totalValue, sub.formula, subContext);
          if (!evaluated.ok) {
            throw new Error(
              `Cannot build the quote: sub-item "${sub.label}" of item "${item.label}" has a formula ("${sub.formula}") that ${
                evaluated.reason === 'error' ? 'fails to evaluate' : 'does not give a finite quantity'
              }. Fix the sub-item formula first.`
            );
          }
        }
        const subQty = evaluateFormula(item, item.totalValue, sub.formula, subContext);
        subContext[toVariableName(sub.label)] = subQty;
        const lineTotal = subQty * sub.price;
        if (lineTotal === 0) continue; // skip zero-cost lines to keep quotes clean
        lines.push({
          description: `${item.label} — ${sub.label}`,
          qty: subQty,
          unit: String(sub.unit),
          unitPrice: sub.price,
          lineTotal,
          itemId: item.id,
        });
      }
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
    fingerprint: await quoteFingerprint({ projectId, lines, total }),
  };
}
