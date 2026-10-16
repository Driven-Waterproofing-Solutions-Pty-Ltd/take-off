-- Auth: in-app users + sessions (single-org for v1).
-- Account creation is admin-only via POST /admin/users with the bootstrap
-- token; no public sign-up, no email verification flow. Sessions are
-- HMAC-signed cookies whose body is stored here so we can revoke without
-- waiting for cookie expiry.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,   -- base64 of PBKDF2-SHA256 derived key
  password_salt   TEXT NOT NULL,   -- base64 of 16 random bytes
  password_iter   INTEGER NOT NULL DEFAULT 600000,
  name            TEXT,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at      INTEGER NOT NULL,
  last_login_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  user_agent  TEXT,
  ip_hash     TEXT             -- SHA-256 of CF-Connecting-IP, for audit
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
