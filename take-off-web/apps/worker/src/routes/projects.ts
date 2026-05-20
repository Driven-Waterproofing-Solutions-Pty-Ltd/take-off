import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAuth } from '../lib/auth';

const app = new Hono<{ Bindings: Env }>();

app.use('*', requireAuth);

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

// Server-bound key — caller cannot choose the prefix. Bound to :id.
app.post('/:id/upload-url', async (c) => {
  const id = c.req.param('id');
  const exists = await c.env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'project not found' }, 404);
  const { filename } = await c.req.json<{ filename: string }>();
  const safe = (filename ?? 'plan.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const fileKey = `projects/${id}/${crypto.randomUUID()}-${safe}`;
  return c.json({ file_key: fileKey });
});

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB

app.put('/:id/upload/:key{.+}', async (c) => {
  const id = c.req.param('id');
  const key = c.req.param('key');

  // Defense in depth: key MUST be scoped to this project's prefix.
  const expectedPrefix = `projects/${id}/`;
  if (!key.startsWith(expectedPrefix) || key.includes('..')) {
    return c.json({ error: 'key not bound to project' }, 403);
  }
  const exists = await c.env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'project not found' }, 404);

  const contentType = c.req.header('Content-Type');
  if (contentType && contentType !== 'application/pdf' && contentType !== 'application/octet-stream') {
    return c.json({ error: 'expected application/pdf' }, 415);
  }
  const lenHeader = c.req.header('Content-Length');
  if (lenHeader && Number(lenHeader) > MAX_PDF_BYTES) {
    return c.json({ error: 'pdf too large' }, 413);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return c.json({ error: 'pdf too large' }, 413);
  }
  await c.env.PDFS.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });
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
  if (!body.file_key.startsWith(`projects/${projectId}/`)) {
    return c.json({ error: 'file_key not bound to project' }, 403);
  }
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
  const projectId = c.req.param('id');
  const key = c.req.param('key');

  // Must be a registered PDF for this project (DB-join check, not just key prefix).
  const owned = await c.env.DB.prepare(
    'SELECT 1 FROM pdfs WHERE project_id = ? AND r2_key = ?'
  )
    .bind(projectId, key)
    .first();
  if (!owned) return c.json({ error: 'not found' }, 404);

  const obj = await c.env.PDFS.get(key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/pdf' },
  });
});

export default app;
