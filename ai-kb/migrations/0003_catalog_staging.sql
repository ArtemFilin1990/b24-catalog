-- =========================================================
-- 0003_catalog_staging.sql
-- Two-stage catalog import: raw rows land in staging first,
-- then get normalized + UPSERTed into catalog_rows.
-- Kept as a thin DDL migration; the actual load + validation
-- statements live in ai-kb/sql/catalog_import.sql and are
-- applied by the ingest worker with parameters (:file_id,
-- :import_batch_id). They are NOT part of this migration
-- because wrangler d1 execute --file cannot bind parameters.
-- =========================================================

CREATE TABLE IF NOT EXISTS staging_catalog_import (
  import_batch_id   TEXT NOT NULL,
  file_id           INTEGER NOT NULL,
  sheet_name        TEXT NOT NULL,
  row_index         INTEGER NOT NULL,

  brand_raw         TEXT,
  prefix_raw        TEXT,
  number_raw        TEXT,
  suffix_raw        TEXT,
  analog_raw        TEXT,
  d_raw             TEXT,
  D_raw             TEXT,
  B_raw             TEXT,
  mass_raw          TEXT,
  seal_raw          TEXT,
  clearance_raw     TEXT,

  raw_row_json      TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staging_catalog_import_batch
  ON staging_catalog_import (import_batch_id, file_id, sheet_name);
