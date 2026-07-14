-- ═══════════════════════════════════════════════════════
-- Migration 0004: Address Cache
-- ═══════════════════════════════════════════════════════
-- Cache Geoscape Predictive / Verify and OSM Nominatim responses.
-- Key = sha256("<provider>|<normalised_query>"). Lazy eviction on miss.
-- TTL guidance: 30d for predictive, 90d for verified.

CREATE TABLE IF NOT EXISTS address_cache (
  cache_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,            -- 'geoscape_predictive' | 'geoscape_verify' | 'osm'
  query_text TEXT NOT NULL,
  response_json TEXT NOT NULL,
  lat REAL,
  lng REAL,
  hits INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_addr_cache_expires ON address_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_addr_cache_provider ON address_cache(provider);
