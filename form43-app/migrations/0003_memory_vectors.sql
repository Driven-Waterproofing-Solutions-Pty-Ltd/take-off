-- ═══════════════════════════════════════════════════════
-- Migration 0003: Memory Vectors (D1 ↔ Vectorize lookup)
-- ═══════════════════════════════════════════════════════
-- Vectorize stores only the embedding + a vector_id; full text and
-- metadata stay in chat_memory. This lookup table joins them.

CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id INTEGER PRIMARY KEY,
  vector_id TEXT NOT NULL UNIQUE,
  embedded_text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (memory_id) REFERENCES chat_memory(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memvec_vector_id ON memory_vectors(vector_id);
