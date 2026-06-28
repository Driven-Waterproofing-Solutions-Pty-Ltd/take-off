/**
 * VectorizeIndex shim — a brute-force cosine store in the same SQLite file.
 *
 * Memory volumes here are tiny (facts/preferences), so an in-SQL load +
 * JS cosine is plenty. Implements the two methods the Worker uses:
 *   index.upsert([{ id, values, metadata }])
 *   index.query(vector, { topK }) -> { matches: [{ id, score }] }
 */

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class VectorizeLocal {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS local_vectors (
        vector_id TEXT PRIMARY KEY,
        values_json TEXT NOT NULL,
        metadata_json TEXT
      );
    `);
  }

  async upsert(items) {
    const stmt = this.sqlite.prepare(
      `INSERT INTO local_vectors (vector_id, values_json, metadata_json)
       VALUES (?, ?, ?)
       ON CONFLICT(vector_id) DO UPDATE SET
         values_json = excluded.values_json,
         metadata_json = excluded.metadata_json`,
    );
    for (const it of items) {
      stmt.run(it.id, JSON.stringify(it.values), JSON.stringify(it.metadata ?? null));
    }
    return { mutationId: 'local', count: items.length };
  }

  async query(vector, opts = {}) {
    const topK = opts.topK ?? 5;
    const rows = this.sqlite.prepare('SELECT vector_id, values_json FROM local_vectors').all();
    const scored = rows.map((r) => ({
      id: r.vector_id,
      score: cosine(vector, JSON.parse(r.values_json)),
    }));
    scored.sort((a, b) => b.score - a.score);
    return { matches: scored.slice(0, topK), count: Math.min(topK, scored.length) };
  }
}
