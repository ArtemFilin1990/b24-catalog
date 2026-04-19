---
name: d1-migration-safety
description: Review D1 migration bootstrap safety, upgrade safety, helper-table dependencies, duplicate rows, id/view collisions, and clean-db behavior across migrations/ (root) and ai-kb/migrations/.
---

Use this skill when a PR adds, edits, or re-orders files in `migrations/*.sql` or `ai-kb/migrations/*.sql`, or adds a new CREATE TABLE/VIEW/INDEX anywhere in the repo.

## Canonical state

Fresh-DB apply order (both workers share D1 `baza`, id `11a157a7-c3e0-4b6b-aa24-3026992db298`):

1. `migrations/0001_root_schema.sql` — core catalog, imports, orders, audit, `schema_migrations`.
2. `migrations/0002_rate_limit.sql` — `rate_limit_tokens` + records version row.
3. `ai-kb/migrations/0001_initial.sql` — `knowledge_base`, `kb_fts` FTS5, `chat_sessions`, `chat_messages`, `query_log`.
4. `ai-kb/migrations/0002_files_rules_catalog.sql` — `files`, `file_extracts`, `kb_chunks` (FK → files ON DELETE CASCADE), `bearing_rules(+mappings)`, `catalog_rows(+issues)`, `jobs`, `admin_audit_log`, `cleanup_log`. **Sets `PRAGMA foreign_keys = ON` at the top.**
5. `ai-kb/migrations/0003_catalog_staging.sql` — `staging_catalog_import`.
6. `ai-kb/migrations/0004_catalog_master_view.sql` — `catalog_master_view` VIEW filtered by validation status.

Memory of reality (do not violate):

- **Only root migrations** insert into `schema_migrations` (`INSERT OR IGNORE`). ai-kb migrations are idempotent-by-shape and do not record version rows. Cross-check applied state with `SELECT type, name FROM sqlite_master …`.
- **D1 does not enforce foreign keys by default.** Any migration relying on FK cascade must `PRAGMA foreign_keys = ON;` in the same script. Runtime code does not set this pragma, so cascades are migration-time only unless re-set per connection.
- **`catalog_fts`** (referenced by `ai-kb/src/index.js:searchCatalog`) is **not** committed in any migration. It is runtime-optional; a fresh DB runs the LIKE fallback until someone creates FTS out-of-band.
- **`settings` table** is created lazily by `ensureSettingsTable` in `ai-kb/src/index.js`. This is grandfathered. **Do not** add more lazy tables — put new schema in a migration.
- **`knowledge_base.content`** can hold a ~300k-character row. Reindex budgets (`REINDEX_CHUNKS_PER_CALL = 12`) are sized around that; migrations that affect chunking strategy must preserve the per-call CPU envelope.

## Bootstrap safety (clean DB)

- [ ] Every `CREATE TABLE` / `CREATE VIEW` / `CREATE INDEX` / `CREATE VIRTUAL TABLE` is `IF NOT EXISTS`.
- [ ] No migration writes to a helper table (audit, schema_migrations, etc.) before that table is created — either create it earlier in the same migration or in an earlier-numbered migration.
- [ ] Triggers on FTS5 virtual tables are created after the FTS5 `CREATE VIRTUAL TABLE` in the same migration.
- [ ] VIEW definitions reference only tables that exist at apply time.
- [ ] Seed `INSERT` statements use `INSERT OR IGNORE` / `INSERT OR REPLACE` to stay idempotent.

## Upgrade safety (existing DB)

- [ ] `ALTER TABLE … ADD COLUMN` is only used on tables guaranteed to exist; otherwise fall back to `CREATE TABLE IF NOT EXISTS` with the new shape + copy.
- [ ] `DROP` statements are forbidden unless the migration explicitly documents intent and has a rollback path.
- [ ] Column rename / retype: introduce new column, backfill, keep old for one migration, drop in the next.
- [ ] For composite state, INSERT uses explicit column lists — do not rely on column ordering.

## Identity & views

- [ ] Raw `id` from two source tables is **not** treated as globally unique. Prefer `uid = <source> || ':' || id` when overlap is possible (e.g. `catalog` + `catalog_rows`).
- [ ] VIEW filters out invalid, quarantined, or unvalidated rows before the bot reads them (`catalog_master_view` does this by validation status).
- [ ] Staging promotion (`staging_catalog_import` → `catalog_rows`) uses `NOT EXISTS` against a stable business key to prevent duplicate promotions.
- [ ] Vector ids are globally unique across domains — `kb-<kb_id>-<chunk>` for knowledge_base; do not reuse the prefix for any other source.

## Hard blockers (do not merge)

- Any new runtime `CREATE TABLE` in worker code (outside grandfathered `ensureSettingsTable`).
- Fresh-DB bootstrap that fails because an earlier migration is missing.
- An ai-kb migration that inserts into `schema_migrations` (intentionally does not, to make re-runs safe).
- A VIEW that allows duplicate logical rows into the read path (`catalog_master_view` or any replacement).
- A migration with `DROP TABLE` / `DROP VIEW` without documented backfill.

## Output

Use the shared shape in `.claude/skills/README.md` (Decision / Why / Blocking fixes / Non-blocking / Merge recommendation). Always cite `path:line` in SQL files.

## References

- `references/bootstrap-safety.md` — the clean-DB rulebook with the real file list.
- `references/view-id-rules.md` — uid patterns and dedupe patterns.

## Scripts

- `scripts/check_migration.sh [target]` — static lint of all SQL files in `migrations/` + `ai-kb/migrations/` against the rules above.
