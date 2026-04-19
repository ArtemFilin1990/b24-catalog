-- =========================================================
-- catalog_import.sql
-- Loader + validation templates for the two-stage XLSX/CSV
-- catalog import pipeline.
--
-- NOT a migration. This file is consumed by the ingest worker
-- which splits on blank lines between "-- @@ <name>" markers
-- and binds :file_id, :import_batch_id per batch.
-- Applying it verbatim with `wrangler d1 execute --file` will
-- fail on the parameter placeholders — that's intentional.
--
-- Pipeline (per uploaded file):
--   1. XLSX parser → INSERTs into staging_catalog_import
--                    with one import_batch_id
--   2. @@ upsert_from_staging  — normalize + UPSERT into catalog_rows
--   3. @@ clear_issues_for_file — drop old issues for this file
--   4. @@ reset_status_for_file — reset statuses to 'pending'
--   5. @@ validate_*            — run every validation block
--   6. @@ finalize_status       — compute valid / partial / invalid
--   7. @@ apply_quarantine      — move hopeless rows into 'quarantine'
--   8. @@ report_*              — optional reports for UI/logs
-- =========================================================


-- @@ upsert_from_staging
-- Normalize + UPSERT one batch from staging_catalog_import
-- into catalog_rows. Handles [[TBD]], em-dash, comma decimals.
INSERT INTO catalog_rows (
  file_id,
  sheet_name,
  row_index,
  brand,
  prefix,
  number,
  suffix,
  designation_full,
  analog,
  d_mm,
  D_mm,
  B_mm,
  mass_kg,
  seal_type,
  clearance,
  bearing_type,
  source_row_hash,
  raw_row_json,
  validation_status,
  validation_notes
)
SELECT
  s.file_id,
  s.sheet_name,
  s.row_index,

  CASE WHEN TRIM(COALESCE(s.brand_raw, '')) IN ('', '—', '[[TBD]]') THEN NULL
       ELSE TRIM(s.brand_raw) END AS brand,

  CASE WHEN TRIM(COALESCE(s.prefix_raw, '')) IN ('', '—', '[[TBD]]') THEN NULL
       ELSE TRIM(s.prefix_raw) END AS prefix,

  CASE WHEN TRIM(COALESCE(s.number_raw, '')) IN ('', '—', '[[TBD]]') THEN NULL
       ELSE TRIM(s.number_raw) END AS number,

  CASE WHEN TRIM(COALESCE(s.suffix_raw, '')) IN ('', '—', '[[TBD]]') THEN NULL
       ELSE TRIM(s.suffix_raw) END AS suffix,

  TRIM(
    COALESCE(CASE WHEN TRIM(COALESCE(s.prefix_raw, '')) IN ('', '—', '[[TBD]]') THEN '' ELSE TRIM(s.prefix_raw) END, '') ||
    COALESCE(CASE WHEN TRIM(COALESCE(s.number_raw, '')) IN ('', '—', '[[TBD]]') THEN '' ELSE TRIM(s.number_raw) END, '') ||
    COALESCE(CASE WHEN TRIM(COALESCE(s.suffix_raw, '')) IN ('', '—', '[[TBD]]') THEN '' ELSE TRIM(s.suffix_raw) END, '')
  ) AS designation_full,

  CASE WHEN TRIM(COALESCE(s.analog_raw, '')) IN ('', '—', '[[TBD]]') THEN NULL
       ELSE TRIM(s.analog_raw) END AS analog,

  CASE WHEN TRIM(COALESCE(s.d_raw, '')) GLOB '*[0-9]*'
            AND TRIM(COALESCE(s.d_raw, '')) NOT IN ('[[TBD]]', '—')
       THEN CAST(REPLACE(TRIM(s.d_raw), ',', '.') AS REAL)
       ELSE NULL END AS d_mm,

  CASE WHEN TRIM(COALESCE(s.D_raw, '')) GLOB '*[0-9]*'
            AND TRIM(COALESCE(s.D_raw, '')) NOT IN ('[[TBD]]', '—')
       THEN CAST(REPLACE(TRIM(s.D_raw), ',', '.') AS REAL)
       ELSE NULL END AS D_mm,

  CASE WHEN TRIM(COALESCE(s.B_raw, '')) GLOB '*[0-9]*'
            AND TRIM(COALESCE(s.B_raw, '')) NOT IN ('[[TBD]]', '—')
       THEN CAST(REPLACE(TRIM(s.B_raw), ',', '.') AS REAL)
       ELSE NULL END AS B_mm,

  CASE WHEN TRIM(COALESCE(s.mass_raw, '')) GLOB '*[0-9]*'
            AND TRIM(COALESCE(s.mass_raw, '')) NOT IN ('[[TBD]]', '—')
       THEN CAST(REPLACE(TRIM(s.mass_raw), ',', '.') AS REAL)
       ELSE NULL END AS mass_kg,

  CASE
    WHEN LOWER(TRIM(COALESCE(s.seal_raw, ''))) IN ('открытый', 'open', 'opened') THEN 'OPEN'
    WHEN UPPER(TRIM(COALESCE(s.seal_raw, ''))) IN ('ZZ', '2Z', 'Z') THEN UPPER(TRIM(s.seal_raw))
    WHEN UPPER(TRIM(COALESCE(s.seal_raw, ''))) IN ('2RS', '2RS1', 'RS', 'LLU', 'DDU') THEN '2RS'
    WHEN TRIM(COALESCE(s.seal_raw, '')) IN ('', '—', '[[TBD]]') THEN NULL
    ELSE 'UNKNOWN'
  END AS seal_type,

  CASE
    WHEN UPPER(TRIM(COALESCE(s.clearance_raw, ''))) IN ('C0', 'CN') THEN 'C0'
    WHEN UPPER(TRIM(COALESCE(s.clearance_raw, ''))) IN ('C2', 'C3', 'C4', 'C5') THEN UPPER(TRIM(s.clearance_raw))
    WHEN TRIM(COALESCE(s.clearance_raw, '')) IN ('', '—', '[[TBD]]') THEN NULL
    ELSE 'UNKNOWN'
  END AS clearance,

  NULL AS bearing_type,
  NULL AS source_row_hash,
  s.raw_row_json,

  'pending' AS validation_status,
  NULL       AS validation_notes
FROM staging_catalog_import s
WHERE s.import_batch_id = :import_batch_id
ON CONFLICT(file_id, sheet_name, row_index) DO UPDATE SET
  brand            = excluded.brand,
  prefix           = excluded.prefix,
  number           = excluded.number,
  suffix           = excluded.suffix,
  designation_full = excluded.designation_full,
  analog           = excluded.analog,
  d_mm             = excluded.d_mm,
  D_mm             = excluded.D_mm,
  B_mm             = excluded.B_mm,
  mass_kg          = excluded.mass_kg,
  seal_type        = excluded.seal_type,
  clearance        = excluded.clearance,
  raw_row_json     = excluded.raw_row_json,
  validation_status = 'pending',
  validation_notes  = NULL;


-- @@ clear_issues_for_file
DELETE FROM catalog_row_issues
WHERE catalog_row_id IN (
  SELECT id
  FROM catalog_rows
  WHERE file_id = :file_id
    AND sheet_name = 'CATALOG_UI'
);


-- @@ reset_status_for_file
UPDATE catalog_rows
SET validation_status = 'pending',
    validation_notes  = NULL
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI';


-- @@ validate_missing_designation
INSERT INTO catalog_row_issues (catalog_row_id, issue_code, severity, issue_details)
SELECT id, 'missing_designation', 'error', 'number/designation_full is null'
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND (number IS NULL OR TRIM(number) = '');


-- @@ validate_missing_dimensions
INSERT INTO catalog_row_issues (catalog_row_id, issue_code, severity, issue_details)
SELECT id, 'missing_dimensions', 'error', 'one or more of d_mm, D_mm, B_mm is null'
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND (d_mm IS NULL OR D_mm IS NULL OR B_mm IS NULL);


-- @@ validate_missing_mass
INSERT INTO catalog_row_issues (catalog_row_id, issue_code, severity, issue_details)
SELECT id, 'missing_mass', 'warn', 'mass_kg is null'
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND mass_kg IS NULL;


-- @@ validate_dimension_order
INSERT INTO catalog_row_issues (catalog_row_id, issue_code, severity, issue_details)
SELECT id, 'invalid_dimension_order', 'error', 'expected D_mm > d_mm and B_mm > 0'
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND d_mm IS NOT NULL
  AND D_mm IS NOT NULL
  AND (D_mm <= d_mm OR B_mm <= 0);


-- @@ validate_dimension_leak
-- Analog number (e.g. "NF 2305") leaked into the D_mm column.
-- Heuristics:
--   - D_mm >= 1000 is implausible for typical industrial catalog outer diameter
--   - analog minus prefix equals D_mm as integer
INSERT INTO catalog_row_issues (catalog_row_id, issue_code, severity, issue_details)
SELECT id, 'dimension_suspected_leak', 'error',
       'D_mm looks like analog/model code rather than outer diameter'
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND analog IS NOT NULL
  AND D_mm IS NOT NULL
  AND (
    CAST(D_mm AS INTEGER) >= 1000
    OR REPLACE(analog, 'NF ', '') = CAST(CAST(D_mm AS INTEGER) AS TEXT)
    OR REPLACE(analog, 'N ',  '') = CAST(CAST(D_mm AS INTEGER) AS TEXT)
    OR REPLACE(analog, 'NJ ', '') = CAST(CAST(D_mm AS INTEGER) AS TEXT)
    OR REPLACE(analog, 'NU ', '') = CAST(CAST(D_mm AS INTEGER) AS TEXT)
  );


-- @@ validate_b_ge_D
INSERT INTO catalog_row_issues (catalog_row_id, issue_code, severity, issue_details)
SELECT id, 'invalid_dimension_order', 'error', 'B_mm is greater than or equal to D_mm'
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND d_mm IS NOT NULL
  AND D_mm IS NOT NULL
  AND B_mm IS NOT NULL
  AND B_mm >= D_mm;


-- @@ validate_clearance
INSERT INTO catalog_row_issues (catalog_row_id, issue_code, severity, issue_details)
SELECT id, 'invalid_clearance', 'warn', 'clearance must be C0/C2/C3/C4/C5'
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND clearance IS NOT NULL
  AND clearance NOT IN ('C0', 'C2', 'C3', 'C4', 'C5');


-- @@ validate_seal_type
INSERT INTO catalog_row_issues (catalog_row_id, issue_code, severity, issue_details)
SELECT id, 'invalid_seal_type', 'warn', 'seal_type must be OPEN/Z/ZZ/2Z/2RS or NULL'
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND seal_type IS NOT NULL
  AND seal_type NOT IN ('OPEN', 'Z', 'ZZ', '2Z', '2RS');


-- @@ finalize_status
UPDATE catalog_rows
SET validation_status = CASE
  WHEN EXISTS (
    SELECT 1 FROM catalog_row_issues i
    WHERE i.catalog_row_id = catalog_rows.id
      AND i.severity = 'error'
  ) THEN 'invalid'
  WHEN EXISTS (
    SELECT 1 FROM catalog_row_issues i
    WHERE i.catalog_row_id = catalog_rows.id
      AND i.severity = 'warn'
  ) THEN 'partial'
  ELSE 'valid'
END
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI';


-- @@ apply_quarantine
UPDATE catalog_rows
SET validation_status = 'quarantine',
    validation_notes  = 'critical data corruption or unusable dimensions'
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND id IN (
    SELECT DISTINCT catalog_row_id
    FROM catalog_row_issues
    WHERE issue_code IN (
      'missing_designation',
      'missing_dimensions',
      'dimension_suspected_leak',
      'invalid_dimension_order'
    )
      AND severity = 'error'
  );


-- @@ report_status_counts
SELECT validation_status, COUNT(*) AS cnt
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
GROUP BY validation_status
ORDER BY cnt DESC;


-- @@ report_top_issues
SELECT issue_code, severity, COUNT(*) AS cnt
FROM catalog_row_issues i
JOIN catalog_rows r ON r.id = i.catalog_row_id
WHERE r.file_id = :file_id
  AND r.sheet_name = 'CATALOG_UI'
GROUP BY issue_code, severity
ORDER BY cnt DESC, issue_code;


-- @@ report_quarantine
SELECT
  r.id,
  r.row_index,
  r.brand,
  r.number,
  r.analog,
  r.d_mm,
  r.D_mm,
  r.B_mm,
  r.mass_kg,
  GROUP_CONCAT(i.issue_code, '; ') AS issues
FROM catalog_rows r
LEFT JOIN catalog_row_issues i ON i.catalog_row_id = r.id
WHERE r.file_id = :file_id
  AND r.sheet_name = 'CATALOG_UI'
  AND r.validation_status = 'quarantine'
GROUP BY r.id, r.row_index, r.brand, r.number, r.analog, r.d_mm, r.D_mm, r.B_mm, r.mass_kg
ORDER BY r.row_index;
