-- Topic-tagged knowledge the takeoff agent pulls at run time. Replaces
-- "skill markdown only visible to Claude Code" with "in D1, served by the
-- worker to the in-app agent AND any MCP client". Seeded out of band via
-- the Cloudflare D1 MCP query tool (separate from this migration so
-- re-runs don't duplicate rows).
--
-- Rows are markdown chunks plus a few searchable facets:
--   topic  : 'methodology' | 'counting-rule' | 'product-system' |
--            'plan-retrieval' | 'rate-cards-current' | 'rate-cards-legacy' |
--            'rate-cards-proposed' | 'labour-rates' | 'worked-examples' |
--            'pavilion-template' | 'ffe-schedule' | 'waste-finish' |
--            'takeoff-record'
--   builder: 'leading-edge' for builder-specific rows, NULL for general.
CREATE TABLE takeoff_knowledge (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  builder TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_takeoff_knowledge_topic ON takeoff_knowledge(topic);
CREATE INDEX idx_takeoff_knowledge_builder ON takeoff_knowledge(builder);
