-- ai-kb D1 schema. Owned by the ai-kb worker.
-- The `catalog` base table is owned by the b24-catalog worker and is NOT
-- redefined here — we only add a full-text mirror over it.
--
-- Apply to an existing D1 with:
--   wrangler d1 execute baza --remote --file ai-kb/schema.sql
--
-- CREATE IF NOT EXISTS is used everywhere, so re-applying is safe.

CREATE TABLE IF NOT EXISTS knowledge_base (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  category   TEXT    NOT NULL DEFAULT 'docs',
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  keywords   TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS knowledge_base_category_idx
  ON knowledge_base(category);

-- Contentless FTS5 mirror of the `catalog` base table. Queried from
-- /api/chat via:
--   SELECT c.* FROM catalog_fts f JOIN catalog c ON c.id = f.rowid
--                WHERE catalog_fts MATCH ?
CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(
  base_number,
  brand,
  type,
  skf_analog,
  fag_analog,
  nsk_analog,
  ntn_analog,
  zwz_analog,
  content = 'catalog',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Rebuild the FTS index after bulk catalog imports:
--   INSERT INTO catalog_fts(catalog_fts) VALUES('rebuild');
