---
name: catalog-import-review
description: Review catalog import pipeline in b24-catalog / ai-kb — from xlsx/csv upload into R2, through staging and normalized rows in D1, to the catalog_master_view read model consumed by the chatbot. Enforces duplicate prevention and idempotent bootstrap.
---

Use this skill when a PR changes any layer of the catalog pipeline:

- root `POST /api/imports` / `DELETE /api/imports/:id` / `POST /api/admin/upload-catalog`
- `migrations/0001_root_schema.sql` `catalog` / `imported_rows` / `import_sessions`
- ai-kb ingest of xlsx/csv into `files` → `file_extracts` → `catalog_rows`
- `staging_catalog_import` or its promotion into `catalog_rows`
- `catalog_master_view` definition or any VIEW that the bot reads from

## Pipeline topology

```
  xlsx/csv upload ──► R2 (vedro) + files(metadata) ──► file_extracts (text/OCR)
                                                     │
                      legacy imports ──► imported_rows ──► catalog  ◄─┐
                                                                     │  fallback when
                                                                     │  catalog_rows empty
                                                                     │
  staging_catalog_import ◄─ (review buffer) ◄── parser ─── file_extracts
           │
           │ (reviewed + approved)
           ▼
       catalog_rows (+ catalog_row_issues)
           │
           ▼
       catalog_master_view (read model consumed by ai-kb chat RAG)
```

The bot will read from `catalog_master_view` once it is wired up; today `ai-kb/src/index.js:searchCatalog` still queries the legacy `catalog` table (with an optional `catalog_fts` virtual table if created out-of-band). Treat the switch-over as a known pending migration step. Never read from `staging_catalog_import`.

## Hard rules

- **Originals in R2, metadata in D1.** The xlsx/csv file itself goes to `vedro`; a row in `files` records the `r2_key`, size, sha256, and status.
- **Staging is a review buffer.** Rows are inserted with `status = 'pending'`. Promotion into `catalog_rows` requires explicit `reviewed_at IS NOT NULL AND status = 'approved'`.
- **Promotion is idempotent.** Use `NOT EXISTS` against a stable business key (`base_number, brand, source_file_id`). Never key on the raw integer `id`.
- **Read model filters invalid rows.** `catalog_master_view` must exclude rows where `validation_status` is quarantined/error. The committed view keeps only `IN ('valid', 'partial')` — see `ai-kb/migrations/0004_catalog_master_view.sql`.
- **Global unique id when unioning sources.** If the view pulls from both `catalog` and `catalog_rows`, use `uid = <source> || ':' || id` — raw `id` collides.
- **No leaking legacy rows that have a normalized replacement.** When the same logical bearing exists in `catalog_rows` (valid) and in legacy `catalog`, the view prefers the normalized row and suppresses the legacy one (`NOT EXISTS` on `base_number + brand`).
- **Bootstrap safe on a clean DB.** `catalog_master_view` depends on `catalog_rows` (ai-kb `0002`); the migration that creates the view (`0004`) must be applied after `0002` — see `.claude/skills/d1-migration-safety`.

## Duplicate prevention — where and how

- **Raw upload → `files`:** dedupe by `sha256` of the uploaded bytes. Two uploads of the same file yield one row.
- **`file_extracts` → `staging_catalog_import`:** parser inserts with `ON CONFLICT DO NOTHING` against `(file_id, row_index)`. Re-parsing a file does not multiply staging rows.
- **`staging_catalog_import` → `catalog_rows`:** `NOT EXISTS` against `(base_number, brand, source_file_id)` so a second approval click does not double-insert.
- **`catalog_rows` → `catalog_master_view`:** the view's `UNION ALL` branches carry distinct source prefixes in `uid`; legacy branch suppressed by `NOT EXISTS` on `base_number + brand` when a valid normalized row exists.

## Red flags to reject

- Promotion that does not check `status = 'approved'` — ingests unreviewed rows into the bot's read path.
- Promotion keyed on `staging_catalog_import.id` only — replay double-inserts.
- View that does not filter `validation_status` — exposes quarantined rows to the bot.
- View that unions `catalog` and `catalog_rows` without a dedupe clause — duplicate bearings in answers.
- New parser that writes directly into `catalog_rows`, skipping staging — removes the review gate.
- Any migration that renames `catalog_master_view` without updating `ai-kb/src/index.js` call sites.

## Output

Shared contract from `.claude/skills/README.md`. Cite `path:line` for SQL findings.

## References

- `references/import-checklist.md` — per-layer checklist.
- `references/view-safety-rules.md` — concrete patterns for duplicate prevention and uid.

## Scripts

- `scripts/review_catalog_sql.sh` — static scan for known anti-patterns in `migrations/*.sql` and `ai-kb/migrations/*.sql`.
