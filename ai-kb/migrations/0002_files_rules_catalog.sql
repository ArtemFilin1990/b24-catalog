PRAGMA foreign_keys = ON;

-- =========================================================
-- 0002_files_rules_catalog.sql
-- D1 schema for:
-- 1) source files in R2
-- 2) extracted text/chunks
-- 3) normalized bearing rules from PDF knowledge sources
-- 4) normalized catalog rows from XLSX/CSV
-- 5) validation, jobs, audit
-- =========================================================

-- ---------------------------------------------------------
-- FILE REGISTRY
-- one row per original uploaded file stored in R2
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type       TEXT NOT NULL CHECK (
                      source_type IN ('pdf','xlsx','xls','csv','docx','txt','md','json','xml','yaml','image','audio','other')
                    ),
  original_name     TEXT NOT NULL,
  mime_type         TEXT,
  r2_key            TEXT NOT NULL UNIQUE,
  sha256            TEXT,
  size_bytes        INTEGER,
  status            TEXT NOT NULL DEFAULT 'uploaded' CHECK (
                      status IN ('uploaded','stored','parsed','indexed','partial','failed','archived','deleted')
                    ),
  parse_error       TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_type_status
  ON files (source_type, status);

CREATE INDEX IF NOT EXISTS idx_files_created_at
  ON files (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_sha256
  ON files (sha256);

-- ---------------------------------------------------------
-- RAW EXTRACTS
-- page text / extracted sheet text / OCR / table text
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_extracts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id           INTEGER NOT NULL,
  extract_type      TEXT NOT NULL CHECK (
                      extract_type IN ('full_text','page_text','sheet_text','table','ocr_text','figure_caption','other')
                    ),
  page_no           INTEGER,
  sheet_name        TEXT,
  section_title     TEXT,
  content           TEXT NOT NULL,
  content_hash      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_extracts_file_type
  ON file_extracts (file_id, extract_type);

CREATE INDEX IF NOT EXISTS idx_file_extracts_page
  ON file_extracts (file_id, page_no);

-- ---------------------------------------------------------
-- CHUNKS FOR AI / VECTOR INDEXING
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_chunks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id           INTEGER NOT NULL,
  chunk_no          INTEGER NOT NULL,
  page_from         INTEGER,
  page_to           INTEGER,
  sheet_name        TEXT,
  title_guess       TEXT,
  content           TEXT NOT NULL,
  embedding_status  TEXT NOT NULL DEFAULT 'pending' CHECK (
                      embedding_status IN ('pending','embedded','failed','skipped')
                    ),
  vector_id         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE (file_id, chunk_no)
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_file
  ON kb_chunks (file_id, chunk_no);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding_status
  ON kb_chunks (embedding_status);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_vector_id
  ON kb_chunks (vector_id);

-- ---------------------------------------------------------
-- NORMALIZED RULES FROM PDF / DOC SOURCES
-- example:
-- rule_group = diameter_code | radial_series | tapered_series
-- source_standard = GOST | ISO | GOST_ISO
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS bearing_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id           INTEGER NOT NULL,
  rule_group        TEXT NOT NULL CHECK (
                      rule_group IN (
                        'architecture',
                        'diameter_code',
                        'diameter_exception',
                        'radial_series',
                        'angular_contact',
                        'tapered_series',
                        'cylindrical_series',
                        'seal_mapping',
                        'clearance_mapping',
                        'tolerance_mapping',
                        'cage_material',
                        'material_mapping',
                        'mounting_feature',
                        'lubrication_feature',
                        'other'
                      )
                    ),
  source_standard   TEXT NOT NULL CHECK (
                      source_standard IN ('GOST','ISO','GOST_ISO')
                    ),
  pattern_from      TEXT,
  pattern_to        TEXT,
  normalized_key    TEXT,
  rule_text         TEXT NOT NULL,
  example_from      TEXT,
  example_to        TEXT,
  confidence        REAL,
  page_ref          TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bearing_rules_group
  ON bearing_rules (rule_group);

CREATE INDEX IF NOT EXISTS idx_bearing_rules_key
  ON bearing_rules (normalized_key);

CREATE INDEX IF NOT EXISTS idx_bearing_rules_from_to
  ON bearing_rules (pattern_from, pattern_to);

-- ---------------------------------------------------------
-- OPTIONAL MAPPING TABLE FOR FAST EXACT LOOKUPS
-- store only exact normalized mappings like:
-- 180205 -> 6205-2RS
-- 6205-2RS -> 180205
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS bearing_rule_mappings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id           INTEGER NOT NULL,
  mapping_type      TEXT NOT NULL CHECK (
                      mapping_type IN ('exact','series','suffix','prefix','derived')
                    ),
  from_value        TEXT NOT NULL,
  to_value          TEXT NOT NULL,
  bearing_type      TEXT,
  notes             TEXT,
  FOREIGN KEY (rule_id) REFERENCES bearing_rules(id) ON DELETE CASCADE,
  UNIQUE (mapping_type, from_value, to_value)
);

CREATE INDEX IF NOT EXISTS idx_bearing_rule_mappings_from
  ON bearing_rule_mappings (from_value);

CREATE INDEX IF NOT EXISTS idx_bearing_rule_mappings_to
  ON bearing_rule_mappings (to_value);

-- ---------------------------------------------------------
-- NORMALIZED CATALOG ROWS FROM XLSX/CSV
-- one row per row of CATALOG_UI or equivalent source
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_rows (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id           INTEGER NOT NULL,
  sheet_name        TEXT NOT NULL,
  row_index         INTEGER NOT NULL,

  brand             TEXT,
  prefix            TEXT,
  number            TEXT,
  suffix            TEXT,
  designation_full  TEXT,
  analog            TEXT,

  d_mm              REAL,
  D_mm              REAL,
  B_mm              REAL,
  mass_kg           REAL,

  seal_type         TEXT,
  clearance         TEXT,

  bearing_type      TEXT,
  source_row_hash   TEXT,
  raw_row_json      TEXT NOT NULL,

  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (
                      validation_status IN ('pending','valid','partial','invalid','quarantine')
                    ),
  validation_notes  TEXT,

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  UNIQUE (file_id, sheet_name, row_index)
);

CREATE INDEX IF NOT EXISTS idx_catalog_rows_designation
  ON catalog_rows (designation_full);

CREATE INDEX IF NOT EXISTS idx_catalog_rows_number
  ON catalog_rows (number);

CREATE INDEX IF NOT EXISTS idx_catalog_rows_analog
  ON catalog_rows (analog);

CREATE INDEX IF NOT EXISTS idx_catalog_rows_dims
  ON catalog_rows (d_mm, D_mm, B_mm);

CREATE INDEX IF NOT EXISTS idx_catalog_rows_validation
  ON catalog_rows (validation_status);

CREATE INDEX IF NOT EXISTS idx_catalog_rows_brand
  ON catalog_rows (brand);

-- ---------------------------------------------------------
-- VALIDATION ISSUES / QUARANTINE REASONS
-- one row per detected issue
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_row_issues (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_row_id    INTEGER NOT NULL,
  issue_code        TEXT NOT NULL CHECK (
                      issue_code IN (
                        'missing_designation',
                        'missing_dimensions',
                        'missing_mass',
                        'invalid_dimension_order',
                        'dimension_suspected_leak',
                        'invalid_clearance',
                        'invalid_seal_type',
                        'bad_numeric_parse',
                        'duplicate_candidate',
                        'manual_review_required',
                        'other'
                      )
                    ),
  severity          TEXT NOT NULL CHECK (
                      severity IN ('info','warn','error')
                    ),
  issue_details     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (catalog_row_id) REFERENCES catalog_rows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_catalog_row_issues_row
  ON catalog_row_issues (catalog_row_id);

CREATE INDEX IF NOT EXISTS idx_catalog_row_issues_code
  ON catalog_row_issues (issue_code, severity);

-- ---------------------------------------------------------
-- JOBS / INGEST / PARSE / OCR / REINDEX
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type          TEXT NOT NULL CHECK (
                      job_type IN ('upload','parse','ocr','chunk','embed','catalog_import','catalog_validate','reindex','cleanup','delete')
                    ),
  file_id           INTEGER,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (
                      status IN ('queued','running','done','failed','cancelled')
                    ),
  payload_json      TEXT,
  result_json       TEXT,
  error_text        TEXT,
  started_at        TEXT,
  finished_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_type
  ON jobs (status, job_type);

CREATE INDEX IF NOT EXISTS idx_jobs_file_id
  ON jobs (file_id);

-- ---------------------------------------------------------
-- ADMIN / AUDIT
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type       TEXT NOT NULL,
  target_type       TEXT,
  target_id         TEXT,
  actor             TEXT,
  details_json      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON admin_audit_log (created_at DESC);

-- ---------------------------------------------------------
-- CLEANUP LOG
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS cleanup_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  cleanup_type      TEXT NOT NULL CHECK (
                      cleanup_type IN ('r2_orphans','old_backups','invalid_rows','stale_jobs','vector_cleanup','full_rebuild','other')
                    ),
  affected_count    INTEGER NOT NULL DEFAULT 0,
  details_json      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cleanup_log_created
  ON cleanup_log (created_at DESC);

-- ---------------------------------------------------------
-- TRIGGERS: updated_at maintenance
-- ---------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_files_updated_at
AFTER UPDATE ON files
FOR EACH ROW
BEGIN
  UPDATE files SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_kb_chunks_updated_at
AFTER UPDATE ON kb_chunks
FOR EACH ROW
BEGIN
  UPDATE kb_chunks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bearing_rules_updated_at
AFTER UPDATE ON bearing_rules
FOR EACH ROW
BEGIN
  UPDATE bearing_rules SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_rows_updated_at
AFTER UPDATE ON catalog_rows
FOR EACH ROW
BEGIN
  UPDATE catalog_rows SET updated_at = datetime('now') WHERE id = NEW.id;
END;
