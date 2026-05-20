-- Phase 1: projects, PDFs, pages, items, shapes, templates
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  customer_id TEXT,
  meta_json   TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pdfs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  r2_key      TEXT NOT NULL,
  name        TEXT,
  page_count  INTEGER NOT NULL,
  page_sizes  TEXT NOT NULL DEFAULT '[]',
  start_page_index INTEGER NOT NULL DEFAULT 0,
  sha256      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pdfs_project ON pdfs(project_id);

CREATE TABLE IF NOT EXISTS pages (
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_index        INTEGER NOT NULL,
  scale_json        TEXT NOT NULL DEFAULT '{"isSet":false,"pixelsPerUnit":0,"unit":"m"}',
  vector_cache_json TEXT,
  name              TEXT,
  PRIMARY KEY (project_id, page_index)
);

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  type            TEXT NOT NULL,
  color           TEXT NOT NULL,
  unit            TEXT NOT NULL,
  total_value     REAL NOT NULL DEFAULT 0,
  group_name      TEXT,
  properties_json TEXT,
  price           REAL,
  formula         TEXT,
  sub_items_json  TEXT,
  visible         INTEGER NOT NULL DEFAULT 1,
  hidden_pages_json TEXT,
  depth           REAL,
  assembly_id     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_project ON items(project_id);

CREATE TABLE IF NOT EXISTS shapes (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  page_index  INTEGER NOT NULL,
  points_json TEXT NOT NULL,
  bulges_json TEXT,
  value       REAL NOT NULL DEFAULT 0,
  deduction   INTEGER NOT NULL DEFAULT 0,
  text        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shapes_item ON shapes(item_id);
CREATE INDEX IF NOT EXISTS idx_shapes_page ON shapes(item_id, page_index);

CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  item_json  TEXT NOT NULL,
  tags_json  TEXT,
  created_at INTEGER NOT NULL
);

-- Phase 2: MCP client tokens (per-installation bearer auth)
CREATE TABLE IF NOT EXISTS mcp_clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

-- Phase 3: memory layer
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  xero_contact_id TEXT UNIQUE,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  last_synced_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS customer_prefs (
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value_json  TEXT NOT NULL,
  PRIMARY KEY (customer_id, key)
);

CREATE TABLE IF NOT EXISTS materials (
  id        TEXT PRIMARY KEY,
  sku       TEXT,
  name      TEXT NOT NULL,
  unit      TEXT NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  supplier  TEXT
);

CREATE TABLE IF NOT EXISTS assemblies (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  unit      TEXT NOT NULL,
  formula   TEXT,
  tags_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assembly_lines (
  assembly_id        TEXT NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  material_id        TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  qty_per_unit       REAL NOT NULL,
  waste_pct          REAL NOT NULL DEFAULT 0,
  labour_min_per_unit REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (assembly_id, material_id)
);

CREATE TABLE IF NOT EXISTS labour_rates (
  id              TEXT PRIMARY KEY,
  role            TEXT NOT NULL,
  hourly_rate     REAL NOT NULL,
  charge_out_rate REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS past_quotes (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_id   TEXT REFERENCES customers(id),
  kind          TEXT NOT NULL,
  total         REAL NOT NULL DEFAULT 0,
  accepted      INTEGER NOT NULL DEFAULT 0,
  xero_id       TEXT,
  snapshot_json TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pq_project ON past_quotes(project_id);
CREATE INDEX IF NOT EXISTS idx_pq_customer ON past_quotes(customer_id);

-- Phase 4: Xero OAuth tokens (encrypted at the app layer)
CREATE TABLE IF NOT EXISTS xero_tokens (
  tenant_id     TEXT PRIMARY KEY,
  tenant_name   TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  scopes        TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
