# catalog-import-review — per-layer checklist

## R2 + `files`

- [ ] Upload handler (`ai-kb/src/files.js`) writes the raw bytes to R2 `vedro` under a deterministic key (`files/<yyyymmdd>/<sha256>-<filename>`).
- [ ] D1 `files` row records: `r2_key`, `size_bytes`, `sha256`, `mime`, `original_filename`, `uploaded_by`, `uploaded_at`, `status`.
- [ ] Duplicate upload (same `sha256`) returns the existing row instead of creating a new one.
- [ ] DELETE path (`DELETE /api/admin/files/:id`) removes the R2 object **and** cascades `kb_chunks` (FK, with `PRAGMA foreign_keys = ON`).

## `file_extracts`

- [ ] One row per page/sheet, keyed by `(file_id, page_or_sheet)`.
- [ ] OCR fallback only triggers when text extraction produced <N chars (document the threshold in the PR).
- [ ] Re-extracting a file does not multiply `file_extracts` rows — use `INSERT OR REPLACE` on the composite key.

## `staging_catalog_import`

- [ ] Inserted with `status = 'pending'`, `reviewed_at = NULL`.
- [ ] Parser error rows land with `status = 'error'` so reviewers can fix them without blocking the batch.
- [ ] A manual admin flow sets `status = 'approved'` + `reviewed_at = datetime('now')`; no automatic promotion without review.
- [ ] Re-parsing the same file does not re-queue already-approved rows.

## `catalog_rows` + `catalog_row_issues`

- [ ] Promotion query:
  ```sql
  INSERT INTO catalog_rows (base_number, brand, type, …, validation_status, source_file_id)
  SELECT s.base_number, s.brand, s.type, …, 'valid', s.file_id
  FROM staging_catalog_import s
  WHERE s.reviewed_at IS NOT NULL
    AND s.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM catalog_rows cr
      WHERE cr.base_number    = s.base_number
        AND cr.brand          = s.brand
        AND cr.source_file_id = s.file_id
    );
  ```
- [ ] `validation_status ∈ {valid, pending, invalid, quarantined}`; invalid rows also get one or more `catalog_row_issues` explaining why.
- [ ] No direct writes into `catalog_rows` outside the promotion path.

## `catalog_master_view`

- [ ] View declaration uses the SQLite-idiomatic idempotent pattern `DROP VIEW IF EXISTS catalog_master_view; CREATE VIEW catalog_master_view AS …` (see `ai-kb/migrations/0004_catalog_master_view.sql`).
- [ ] Filters `validation_status IN ('valid', 'partial')` on the `catalog_rows` branch (today the view is single-source over `catalog_rows`; reject PRs that remove the filter).
- [ ] When the view is extended to union with the legacy `catalog` table, it **must** expose `uid` with source prefix and dedupe the legacy branch with `NOT EXISTS (base_number + brand)`.
- [ ] Stable column list; matches what `ai-kb/src/index.js:searchCatalog` + `catalogRowToText` expect — currently these still read from the legacy `catalog` table, so any switch-over must update the callers in the same PR.
- [ ] Whenever the view shape changes, `catalogRowToText` is updated in the same PR.

## Root `/api/imports` (legacy)

- [ ] `GET /api/imports` stays public (consumed by `public/index.html`).
- [ ] `POST /api/imports` gated by `requireAdmin` + `audit`.
- [ ] `DELETE /api/imports/:id` performs a soft delete (flag column), not a physical row delete, so audit trail survives.
- [ ] `POST /api/admin/upload-catalog` remains the **only** route guarded by `requireUpload`.

## Bot read path

- [ ] `searchCatalog` queries the read model once the bot is wired to `catalog_master_view`; today it still hits the legacy `catalog` table (and optional `catalog_fts`). Any PR that adds a cutover must update both the view and the worker in the same change.
- [ ] FTS5 path (`catalog_fts`) is runtime-optional — no committed migration creates it.
- [ ] Rows are fed into the LLM via `catalogRowToText` only; never the raw row object.
