-- =========================================================
-- 0004_catalog_master_view.sql
-- Clean, denormalized read model over catalog_rows for the
-- API and chatbot. Only rows that passed validation.
--
-- Hard rule: invalid + quarantine rows are excluded here.
-- partial rows are included so the bot can still answer on
-- a row missing e.g. mass_kg, but the consumer should check
-- validation_status if strict valid-only is required.
--
-- Depends on: 0002_files_rules_catalog.sql
-- Safe to re-apply: uses DROP VIEW IF EXISTS + CREATE VIEW.
-- =========================================================

DROP VIEW IF EXISTS catalog_master_view;

CREATE VIEW catalog_master_view AS
SELECT
  r.id                 AS row_id,
  r.file_id,
  r.sheet_name,
  r.row_index,

  r.brand,
  r.prefix,
  r.number,
  r.suffix,

  -- Canonical designation string used for matching / display.
  -- Prefer the already-normalized designation_full; fall back
  -- to a recomputed concat if it got nulled mid-pipeline.
  COALESCE(
    NULLIF(TRIM(r.designation_full), ''),
    TRIM(COALESCE(r.prefix, '') || COALESCE(r.number, '') || COALESCE(r.suffix, ''))
  )                    AS full_name,

  r.analog,
  r.bearing_type,

  r.d_mm,
  r.D_mm,
  r.B_mm,
  r.mass_kg,

  r.seal_type,
  r.clearance,

  r.validation_status,
  r.created_at,
  r.updated_at
FROM catalog_rows r
WHERE r.validation_status IN ('valid', 'partial')
  AND COALESCE(TRIM(r.number), '') <> ''
  AND r.d_mm IS NOT NULL
  AND r.D_mm IS NOT NULL
  AND r.B_mm IS NOT NULL
  AND r.D_mm >  r.d_mm
  AND r.B_mm >  0
  AND r.B_mm <  r.D_mm;
