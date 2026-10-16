import type { MemoryRow } from '../../shared/types';
import { embedText } from './embed';

export interface SearchHit extends MemoryRow {
  score: number;
}

export async function semanticSearch(
  ai: Ai,
  index: VectorizeIndex,
  db: D1Database,
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  const queryVec = await embedText(ai, query);
  const matches = await index.query(queryVec, { topK: limit, returnMetadata: 'none' });
  if (matches.matches.length === 0) return [];

  const memoryIds = matches.matches
    .map((m) => parseInt(m.id.replace(/^mem_/, ''), 10))
    .filter((n) => Number.isFinite(n));
  if (memoryIds.length === 0) return [];

  const placeholders = memoryIds.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT * FROM chat_memory WHERE id IN (${placeholders}) AND is_active = 1`,
  ).bind(...memoryIds).all<MemoryRow>();

  const scoreById = new Map(matches.matches.map((m) => [parseInt(m.id.replace(/^mem_/, ''), 10), m.score]));
  const hits: SearchHit[] = (results || [])
    .map((row) => ({ ...row, score: scoreById.get(row.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  if (hits.length > 0) {
    await db.prepare(
      `UPDATE chat_memory SET times_referenced = times_referenced + 1 WHERE id IN (${placeholders})`,
    ).bind(...hits.map((h) => h.id)).run();
  }

  return hits;
}

export async function literalSearch(
  db: D1Database,
  query: string,
  limit: number,
): Promise<MemoryRow[]> {
  const like = `%${query.replace(/[%_]/g, (m) => '\\' + m)}%`;
  const { results } = await db.prepare(
    `SELECT * FROM chat_memory WHERE is_active = 1 AND content LIKE ? ESCAPE '\\'
     ORDER BY times_referenced DESC, created_at DESC LIMIT ?`,
  ).bind(like, limit).all<MemoryRow>();
  return results || [];
}
