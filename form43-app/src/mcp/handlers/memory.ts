import type { ToolContext, ToolResult } from '../tools';
import { embedAndStore } from '../../modules/memory/embed';
import { semanticSearch, literalSearch } from '../../modules/memory/search';
import { logActivity } from '../../shared/activity';
import type { MemoryRow } from '../../shared/types';

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export async function handleMemory(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const db = ctx.env.FORM43_DB;

  if (name === 'save_memory') {
    if (input.confirm !== true) {
      return jsonResult({ success: true, pending: true, action: 'save_memory', payload: input, hint: 'Call again with confirm:true to commit.' });
    }
    const content = String(input.content ?? '');
    if (!content) return jsonResult({ success: false, error: 'Missing content' });
    const result = await db.prepare(
      `INSERT INTO chat_memory (memory_type, category, content, source_session_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      (input.memory_type as string) ?? 'LONG_TERM',
      (input.category as string) ?? 'GENERAL',
      content,
      (input.source_session_id as string) ?? null,
      (input.expires_at as string) ?? null,
    ).run();
    const id = result.meta.last_row_id as number;

    let embedding: { vector_id: string; reused: boolean } | null = null;
    try {
      embedding = await embedAndStore(ctx.env.AI, ctx.env.MEMORY_INDEX, db, id, content);
    } catch (e) {
      await logActivity(db, 'MEMORY_EMBED_FAILED', String((e as Error).message), String(id), ctx.vars.correlationId, ctx.vars.tokenHash);
    }
    await logActivity(db, 'MEMORY_SAVED', `Memory ${id} via MCP`, String(id), ctx.vars.correlationId, ctx.vars.tokenHash);
    return jsonResult({ success: true, data: { id, embedding } });
  }

  if (name === 'search_memory') {
    const query = String(input.query ?? '').trim();
    if (!query) return jsonResult({ success: false, error: 'Missing query' });
    const limit = Math.min((input.limit as number) ?? 10, 20);
    const semantic = input.semantic !== false;

    try {
      if (semantic) {
        const hits = await semanticSearch(ctx.env.AI, ctx.env.MEMORY_INDEX, db, query, limit);
        return jsonResult({ success: true, data: hits, mode: 'semantic', count: hits.length });
      }
      const rows = await literalSearch(db, query, limit);
      return jsonResult({ success: true, data: rows, mode: 'literal', count: rows.length });
    } catch (e: unknown) {
      const rows = await literalSearch(db, query, limit);
      return jsonResult({ success: true, data: rows, mode: 'literal_fallback', fallback_reason: (e as Error).message, count: rows.length });
    }
  }

  if (name === 'list_recent_memory') {
    const limit = Math.min((input.limit as number) ?? 20, 50);
    const category = input.category as string | undefined;
    const sql = category
      ? 'SELECT * FROM chat_memory WHERE is_active = 1 AND category = ? ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM chat_memory WHERE is_active = 1 ORDER BY created_at DESC LIMIT ?';
    const stmt = category
      ? db.prepare(sql).bind(category, limit)
      : db.prepare(sql).bind(limit);
    const { results } = await stmt.all<MemoryRow>();
    return jsonResult({ success: true, data: results, count: results?.length ?? 0 });
  }

  if (name === 'pin_memory') {
    if (input.confirm !== true) {
      return jsonResult({ success: true, pending: true, action: 'pin_memory', id: input.id, hint: 'Call again with confirm:true to commit.' });
    }
    const id = input.id as number;
    await db.prepare(
      "UPDATE chat_memory SET memory_type = 'PINNED', never_expires = 1, updated_at = datetime('now') WHERE id = ?",
    ).bind(id).run();
    await logActivity(db, 'MEMORY_PINNED', `Memory ${id} pinned via MCP`, String(id), ctx.vars.correlationId, ctx.vars.tokenHash);
    return jsonResult({ success: true, data: { id } });
  }

  return { isError: true, content: [{ type: 'text', text: `Unknown memory tool: ${name}` }] };
}
