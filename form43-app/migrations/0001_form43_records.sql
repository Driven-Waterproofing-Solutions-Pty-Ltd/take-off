-- ═══════════════════════════════════════════════════════
-- Migration 0001: Form 43 Records
-- ═══════════════════════════════════════════════════════
-- QLD Form 43 — Certificate of Compliance for Waterproofing.
-- Ported from aqua migrations/0013_form43.sql with is_active +
-- deleted_at baked in from the start (aqua's later migration
-- added them implicitly; we don't carry that scar forward).

CREATE TABLE IF NOT EXISTS form43_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  street_address TEXT NOT NULL,
  suburb TEXT,
  postcode TEXT,
  lga TEXT,
  building_class TEXT DEFAULT '1a',
  building_desc TEXT DEFAULT 'New residential dwelling',
  products_used TEXT DEFAULT '[]',
  areas_waterproofed TEXT DEFAULT '[]',
  certifier_ref TEXT,
  da_number TEXT,
  insp_date TEXT,
  cert_date TEXT,
  notes TEXT,
  generated_by TEXT DEFAULT 'manual',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_form43_job_id  ON form43_records(job_id);
CREATE INDEX IF NOT EXISTS idx_form43_created ON form43_records(created_at);
CREATE INDEX IF NOT EXISTS idx_form43_active  ON form43_records(is_active);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  resource_id TEXT,
  correlation_id TEXT,
  token_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_event   ON activity_log(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
