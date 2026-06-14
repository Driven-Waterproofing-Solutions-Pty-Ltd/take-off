import { Hono } from 'hono';
import type { Env } from '../env';
import { tools } from '@takeoff/shared';
import {
  searchProjects,
  recallCustomer,
  listAssemblies,
  applyAssembly,
  buildQuote,
} from '../tools/memory';
import { requireAuth, requireAdmin } from '../lib/auth';

const app = new Hono<{ Bindings: Env }>();

// READS: any authenticated caller (incl. MCP) can list assemblies / search
// customers etc.
app.use('*', requireAuth);

app.get('/projects/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const limit = parseInt(c.req.query('limit') ?? '10', 10);
  return c.json(await searchProjects(c.env, { query: q, limit }));
});

app.get('/customers/search', async (c) => {
  const q = c.req.query('q') ?? '';
  return c.json(await recallCustomer(c.env, { query: q }));
});

app.get('/assemblies', async (c) => {
  const tag = c.req.query('tag') ?? undefined;
  return c.json(await listAssemblies(c.env, { tag }));
});

// WRITES to the org-wide pricing catalog (assemblies / materials) flow into
// buildQuote for every project, so they're admin-only. A non-admin member or
// an MCP token shouldn't be able to alter the rates a customer sees.
app.post('/assemblies', requireAdmin, async (c) => {
  const body = await c.req.json<{
    name: string;
    unit: string;
    formula?: string;
    tags?: string[];
    lines?: Array<{
      material_id: string;
      qty_per_unit: number;
      waste_pct?: number;
      labour_min_per_unit?: number;
    }>;
  }>();
  const lines = body.lines ?? [];

  // Pre-validate every referenced material before we touch the assemblies
  // table. Without this, the assembly row commits and a later
  // assembly_lines insert can fail (typo'd material_id, dup key) leaving
  // list_assemblies exposing a half-built assembly that buildQuote uses
  // with missing material lines.
  if (lines.length > 0) {
    const materialIds = Array.from(new Set(lines.map((l) => l.material_id)));
    const rows = (
      await c.env.DB.prepare(
        `SELECT id FROM materials WHERE id IN (${materialIds.map(() => '?').join(',')})`
      )
        .bind(...materialIds)
        .all()
    ).results as Array<{ id: string }>;
    const found = new Set(rows.map((r) => r.id));
    const missing = materialIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      return c.json({ error: 'unknown material_id(s)', missing }, 400);
    }
    // Catch duplicate (assembly_id, material_id) PK collisions in the input.
    const dup = new Set<string>();
    for (const l of lines) {
      if (dup.has(l.material_id)) {
        return c.json({ error: 'duplicate material_id in lines', material_id: l.material_id }, 400);
      }
      dup.add(l.material_id);
    }
  }

  const id = crypto.randomUUID();
  // D1.batch() runs statements in a single implicit transaction — if any
  // INSERT fails the whole batch rolls back, so list_assemblies never sees
  // a partial assembly row.
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO assemblies (id, name, unit, formula, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      body.name,
      body.unit,
      body.formula ?? null,
      body.tags ? JSON.stringify(body.tags) : null,
      Date.now()
    ),
    ...lines.map((line) =>
      c.env.DB.prepare(
        `INSERT INTO assembly_lines (assembly_id, material_id, qty_per_unit, waste_pct, labour_min_per_unit)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        id,
        line.material_id,
        line.qty_per_unit,
        line.waste_pct ?? 0,
        line.labour_min_per_unit ?? 0
      )
    ),
  ];
  await c.env.DB.batch(stmts);
  return c.json({ id });
});

app.post('/materials', requireAdmin, async (c) => {
  const body = await c.req.json<{
    name: string;
    unit: string;
    unit_cost: number;
    sku?: string;
    supplier?: string;
  }>();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO materials (id, sku, name, unit, unit_cost, supplier) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, body.sku ?? null, body.name, body.unit, body.unit_cost, body.supplier ?? null)
    .run();
  return c.json({ id });
});

app.post('/apply-assembly', async (c) => {
  const body = await c.req.json();
  const input = tools.apply_assembly.input.parse(body);
  return c.json(await applyAssembly(c.env, input));
});

app.get('/quote/:projectId', async (c) => {
  return c.json(await buildQuote(c.env, c.req.param('projectId')));
});

export default app;
