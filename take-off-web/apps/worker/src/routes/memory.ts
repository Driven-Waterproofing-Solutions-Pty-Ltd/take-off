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

const app = new Hono<{ Bindings: Env }>();

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

app.post('/assemblies', async (c) => {
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
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO assemblies (id, name, unit, formula, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.name,
      body.unit,
      body.formula ?? null,
      body.tags ? JSON.stringify(body.tags) : null,
      Date.now()
    )
    .run();
  for (const line of body.lines ?? []) {
    await c.env.DB.prepare(
      `INSERT INTO assembly_lines (assembly_id, material_id, qty_per_unit, waste_pct, labour_min_per_unit)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        line.material_id,
        line.qty_per_unit,
        line.waste_pct ?? 0,
        line.labour_min_per_unit ?? 0
      )
      .run();
  }
  return c.json({ id });
});

app.post('/materials', async (c) => {
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
