-- Login throttling. /auth/login records each failed attempt under two keys
-- (the normalised email and a SHA-256 of the client IP) and refuses further
-- attempts for a key once it has too many failures inside the window, before
-- running the 100k-iteration PBKDF2 check. Rows older than the window are
-- pruned by the nightly cron. Additive and idempotent.
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT    NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key ON login_attempts(key, attempted_at);
