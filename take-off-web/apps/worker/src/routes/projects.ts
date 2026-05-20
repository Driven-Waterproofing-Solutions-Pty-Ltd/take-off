import { Hono } from 'hono';
import type { Env } from '../env';

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const body = await c.req.json<{ name: string; customer_id?: string }>();
  if (!body.name) return c.json({ error: 'name is required' }, 400);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO projects (id, name, customer_id, meta_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, body.name, body.customer_id ?? null, '{}', now, now)
    .run();
  return c.json({ id, name: body.name, created_at: now });
});

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, customer_id, created_at, updated_at FROM projects ORDER BY updated_at DESC LIMIT 100'
  ).all();
  return c.json(rows.results);
});

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!project) return c.json({ error: 'not found' }, 404);
  const pdfs = await c.env.DB.prepare('SELECT * FROM pdfs WHERE project_id = ?').bind(id).all();
  const pages = await c.env.DB.prepare('SELECT * FROM pages WHERE project_id = ?').bind(id).all();
  return c.json({ project, pdfs: pdfs.results, pages: pages.results });
});

// Get a signed upload key — client PUTs PDF bytes to R2 directly via the worker
app.post('/:id/upload-url', async (c) => {
  const id = c.req.param('id');
  const { filename } = await c.req.json<{ filename: string }>();
  const fileKey = `projects/${id}/${crypto.randomUUID()}-${filename}`;
  return c.json({ file_key: fileKey });
});

app.put('/:id/upload/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const bytes = await c.req.arrayBuffer();
  await c.env.PDFS.put(key, bytes);
  return c.json({ ok: true, key });
});

app.post('/:id/pdfs', async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json<{
    file_key: string;
    name?: string;
    page_count: number;
    page_sizes: Array<{ width: number; height: number }>;
    start_page_index?: number;
    sha256?: string;
  }>();
  const pdfId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO pdfs (id, project_id, r2_key, name, page_count, page_sizes, start_page_index, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      pdfId,
      projectId,
      body.file_key,
      body.name ?? null,
      body.page_count,
      JSON.stringify(body.page_sizes),
      body.start_page_index ?? 0,
      body.sha256 ?? null,
      Date.now()
    )
    .run();
  return c.json({ pdf_id: pdfId, page_count: body.page_count, page_sizes: body.page_sizes });
});

app.get('/:id/pdfs/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const obj = await c.env.PDFS.get(key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/pdf' },
  });
});

export default app;
