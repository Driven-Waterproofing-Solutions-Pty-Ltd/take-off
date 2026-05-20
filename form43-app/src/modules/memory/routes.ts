import { Hono } from 'hono';
import { z } from 'zod';
import type { AppType, MemoryRow } from '../../shared/types';
import { logActivity } from '../../shared/activity';
import { ok, err } from '../../shared/response';
import { embedAndStore } from './embed';
import { semanticSearch, literalSearch } from './search';
import { rateLimit } from '../../middleware/rate-limit';
import { snapshotMemory } from './backup';

const router = new Hono<AppType>();

const MemoryTypeEnum = z.enum(['LONG_TERM', 'SHORT_TERM', 'PINNED']);
const MemoryCategoryEnum = z.enum(['PREFERENCE', 'FACT', 'DECISION', 'BUILDER', 'GENERAL']);

const SaveInput = z.object({
  content: z.string().min(1),
  category: MemoryCategoryEnum.default('GENERAL'),
  memory_type: MemoryTypeEnum.default('LONG_TERM'),
  source_session_id: z.string().optional(),
  expires_at: z.string().optional(),
  confirm: z.boolean().optional(),
});

router.post('/save', rateLimit('memory_save'), async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json(err('Invalid JSON'), 400); }
  const parsed = SaveInput.safeParse(body);
  if (!parsed.success) return c.json(err(`Invalid input: ${parsed.error.message}`), 400);
  const input = parsed.data;

  if (input.confirm === false) {
    return c.json(ok({ pending: true, action: 'memory_save', payload: input }, { message: 'Call again with confirm:true to commit' }));
  }

  try {
    const result = await c.env.FORM43_DB.prepare(
      `INSERT INTO chat_memory (memory_type, category, content, source_session_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      input.memory_type,
      input.category,
      input.content,
      input.source_session_id ?? null,
      input.expires_at ?? null,
    ).run();

    const id = result.meta.last_row_id as number;

    let embedding: { vector_id: string; reused: boolean } | null = null;
    try {
      embedding = await embedAndStore(c.env.AI, c.env.MEMORY_INDEX, c.env.FORM43_DB, id, input.content);
    } catch (e) {
      // Embedding failures don't block the memory save — searchability degrades to literal.
      await logActivity(c.env.FORM43_DB, 'MEMORY_EMBED_FAILED', String((e as Error).message), String(id), c.get('correlationId'), c.get('tokenHash'));
    }

    await logActivity(c.env.FORM43_DB, 'MEMORY_SAVED', `Memory ${id} (${input.category})`, String(id), c.get('correlationId'), c.get('tokenHash'));

    return c.json(ok({ id, embedding }), 201);
  } catch (e: unknown) {
    return c.json(err((e as Error).message), 500);
  }
});

router.get('/search', async (c) => {
  const query = (c.req.query('q') || '').trim();
  if (!query) return c.json(err('Missing q'), 400);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 20);
  const semantic = c.req.query('semantic') !== '0';

  try {
    if (semantic) {
      const hits = await semanticSearch(c.env.AI, c.env.MEMORY_INDEX, c.env.FORM43_DB, query, limit);
      return c.json(ok(hits, { mode: 'semantic', count: hits.length }));
    }
    const rows = await literalSearch(c.env.FORM43_DB, query, limit);
    return c.json(ok(rows, { mode: 'literal', count: rows.length }));
  } catch (e: unknown) {
    // Vectorize/AI may not be configured in some envs — fall through to literal.
    const rows = await literalSearch(c.env.FORM43_DB, query, limit);
    return c.json(ok(rows, { mode: 'literal_fallback', count: rows.length, fallback_reason: (e as Error).message }));
  }
});

router.get('/recent', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 50);
  const category = c.req.query('category');

  const sql = category
    ? 'SELECT * FROM chat_memory WHERE is_active = 1 AND category = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM chat_memory WHERE is_active = 1 ORDER BY created_at DESC LIMIT ?';
  const stmt = category
    ? c.env.FORM43_DB.prepare(sql).bind(category, limit)
    : c.env.FORM43_DB.prepare(sql).bind(limit);
  const { results } = await stmt.all<MemoryRow>();
  return c.json(ok(results || [], { count: (results || []).length }));
});

router.post('/pin/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json(err('Invalid id'), 400);

  let body: { confirm?: boolean } = {};
  try { body = await c.req.json(); } catch { /* allow empty body */ }
  if (body.confirm === false) {
    return c.json(ok({ pending: true, action: 'memory_pin', id }, { message: 'Call again with confirm:true' }));
  }

  await c.env.FORM43_DB.prepare(
    "UPDATE chat_memory SET memory_type = 'PINNED', never_expires = 1, updated_at = datetime('now') WHERE id = ?",
  ).bind(id).run();
  await logActivity(c.env.FORM43_DB, 'MEMORY_PINNED', `Memory ${id} pinned`, String(id), c.get('correlationId'), c.get('tokenHash'));
  return c.json(ok({ id }));
});

router.post('/backup', async (c) => {
  const result = await snapshotMemory(c.env);
  if (!result) return c.json(err('R2 backup disabled or unconfigured'), 503);
  return c.json(ok(result));
});

export default router;
