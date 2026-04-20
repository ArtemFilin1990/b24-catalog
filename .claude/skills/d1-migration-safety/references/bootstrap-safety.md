# D1 bootstrap safety (clean DB)

Target: a fresh, empty D1 `baza` must accept every committed migration **in order** without error.

## The committed order

```
migrations/0001_root_schema.sql
migrations/0002_rate_limit.sql
ai-kb/migrations/0001_initial.sql
ai-kb/migrations/0002_files_rules_catalog.sql
ai-kb/migrations/0003_catalog_staging.sql
ai-kb/migrations/0004_catalog_master_view.sql
```

Apply:
```bash
for f in migrations/0001_root_schema.sql migrations/0002_rate_limit.sql \
         ai-kb/migrations/0001_initial.sql ai-kb/migrations/0002_files_rules_catalog.sql \
         ai-kb/migrations/0003_catalog_staging.sql ai-kb/migrations/0004_catalog_master_view.sql; do
  npx wrangler d1 execute baza --remote --file="$f"
done
```

## Rules every new migration must obey

- **`IF NOT EXISTS` everywhere.** `CREATE TABLE`, `CREATE VIEW`, `CREATE INDEX`, `CREATE VIRTUAL TABLE`, `CREATE TRIGGER` (D1 supports `CREATE TRIGGER IF NOT EXISTS`).
- **FK pragma lives in the migration, not in code.** `ai-kb/migrations/0002_files_rules_catalog.sql` begins with `PRAGMA foreign_keys = ON;`. Runtime code never sets it; D1 connections default to OFF.
- **No writes to helper tables that may not exist yet.** Do not `INSERT INTO schema_migrations …` from an ai-kb migration (only root migrations record versions). Do not `INSERT INTO admin_audit_log …` from a migration that does not also create the table.
- **Seeds are idempotent.** Use `INSERT OR IGNORE` (duplicate-safe natural keys) or `INSERT OR REPLACE` (upsert semantics). Never a bare `INSERT` that will fail on re-run.
- **Triggers after their table/FTS.** If you add an FTS5 sync trigger, declare it after `CREATE VIRTUAL TABLE … USING fts5(…)` in the same file.
- **No cross-file dependency on uncommitted state.** A migration must work against the state produced by all previously numbered committed migrations — nothing else.

## Comments must match behavior

- If a migration says "creates X", `CREATE X` must be present.
- If it says "idempotent", every `CREATE`/`INSERT` must be guarded.
- If it documents a cascade, the `ON DELETE CASCADE` must be present **and** `PRAGMA foreign_keys = ON;` must be in the same file.

## Existing-DB upgrade

- Re-running the full migration set against an already-populated DB must be a no-op.
- `ALTER TABLE … ADD COLUMN` is acceptable **only** on tables guaranteed to exist from earlier committed migrations.
- For a backwards-incompatible column change: introduce new column → backfill in the same migration → keep old column for one release → drop in the next. Never rename + drop in a single migration.

## Verification queries

```sql
-- applied root versions
SELECT version, applied_at FROM schema_migrations ORDER BY version;

-- actual DB objects (authoritative for ai-kb state)
SELECT type, name FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_%'
  ORDER BY type, name;

-- confirm catalog_master_view filters validation state
SELECT sql FROM sqlite_master WHERE name = 'catalog_master_view';
```
