-- ═══════════════════════════════════════════════════════
-- Migration 0002: Chat Memory (self-contained)
-- ═══════════════════════════════════════════════════════
-- Shape-compatible with aqua's chat_memory (migrations/0052_chat_module.sql)
-- so any AI client familiar with aqua's memory surface sees the same fields.
-- BEFORE DELETE trigger blocks hard deletes (mirrors aqua HR-8 spirit) —
-- callers MUST soft-delete via UPDATE ... SET is_active = 0.

CREATE TABLE IF NOT EXISTS chat_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_type TEXT NOT NULL DEFAULT 'LONG_TERM',  -- LONG_TERM | SHORT_TERM | PINNED
  category TEXT NOT NULL DEFAULT 'GENERAL',       -- PREFERENCE | FACT | DECISION | BUILDER | GENERAL
  content TEXT NOT NULL,
  source_session_id TEXT,
  times_referenced INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  never_expires INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mem_type     ON chat_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_mem_category ON chat_memory(category);
CREATE INDEX IF NOT EXISTS idx_mem_active   ON chat_memory(is_active);

CREATE TRIGGER IF NOT EXISTS trg_chat_memory_no_hard_delete
BEFORE DELETE ON chat_memory
BEGIN
  SELECT RAISE(ABORT, 'chat_memory is protected — soft-delete via is_active = 0');
END;
