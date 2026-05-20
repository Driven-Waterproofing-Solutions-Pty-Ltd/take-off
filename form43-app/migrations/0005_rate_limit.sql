-- ═══════════════════════════════════════════════════════
-- Migration 0005: Rate Limit (D1 fallback)
-- ═══════════════════════════════════════════════════════
-- Used when RATE_LIMIT_KV binding is not configured. Sliding window:
-- (token_hash, window_start) is incremented on each request; rows older
-- than the largest window are eligible for pruning.

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  token_hash TEXT NOT NULL,
  bucket TEXT NOT NULL,             -- e.g. 'address_autocomplete', 'memory_save'
  window_start INTEGER NOT NULL,    -- unix epoch (seconds) rounded to window size
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token_hash, bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rl_window ON rate_limit_counters(window_start);
