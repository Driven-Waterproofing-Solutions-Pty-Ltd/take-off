/**
 * Embed text via Workers AI BGE-large (1024-dim) and upsert into Vectorize.
 * Mirrors aqua's src/shared/vectorize-memory.ts embed pattern.
 *
 * Vectorize stores only the embedding + a vector_id; the full memory row
 * stays in chat_memory. memory_vectors links them.
 */

import { sha256Hex } from '../../shared/activity';

const EMBED_MODEL = '@cf/baai/bge-large-en-v1.5';
const VECTOR_DIM = 1024;

export async function embedText(ai: Ai, text: string): Promise<number[]> {
  const out = await ai.run(EMBED_MODEL as never, { text }) as { data?: number[][] };
  const vec = out.data?.[0];
  if (!vec || vec.length !== VECTOR_DIM) {
    throw new Error(`Embedding failed: expected ${VECTOR_DIM} dims, got ${vec?.length ?? 0}`);
  }
  return vec;
}

export async function embedAndStore(
  ai: Ai,
  index: VectorizeIndex,
  db: D1Database,
  memoryId: number,
  text: string,
): Promise<{ vector_id: string; reused: boolean }> {
  const hash = await sha256Hex(text);

  const existing = await db.prepare(
    'SELECT vector_id, embedded_text_hash FROM memory_vectors WHERE memory_id = ?',
  ).bind(memoryId).first<{ vector_id: string; embedded_text_hash: string }>();

  if (existing && existing.embedded_text_hash === hash) {
    return { vector_id: existing.vector_id, reused: true };
  }

  const vector_id = `mem_${memoryId}`;
  const values = await embedText(ai, text);
  await index.upsert([{ id: vector_id, values, metadata: { memory_id: memoryId } }]);

  await db.prepare(
    `INSERT INTO memory_vectors (memory_id, vector_id, embedded_text_hash)
     VALUES (?, ?, ?)
     ON CONFLICT(memory_id) DO UPDATE SET
       vector_id = excluded.vector_id,
       embedded_text_hash = excluded.embedded_text_hash,
       updated_at = datetime('now')`,
  ).bind(memoryId, vector_id, hash).run();

  return { vector_id, reused: false };
}
