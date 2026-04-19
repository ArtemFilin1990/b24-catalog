# catalog view safety — patterns to require, anti-patterns to reject

## Require

### 1. Idempotent view declaration

SQLite does not support `CREATE OR REPLACE VIEW`. Use the committed idiomatic pattern:

```sql
DROP VIEW IF EXISTS catalog_master_view;
CREATE VIEW catalog_master_view AS
SELECT
  'catalog_rows:' || r.id AS uid,
  r.* ,
  r.validation_status
FROM catalog_rows r
WHERE r.validation_status IN ('valid', 'partial');
```

See `ai-kb/migrations/0004_catalog_master_view.sql` for the live version. When this view is unioned with the legacy `catalog` table in a future PR, extend with:

```sql
UNION ALL
SELECT 'catalog:' || c.id AS uid, … FROM catalog c
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_rows cr2
  WHERE cr2.validation_status IN ('valid','partial')
    AND cr2.base_number = c.base_number
    AND cr2.brand       = c.brand
);
```

### 2. Dedupe on business key, not on raw id

`NOT EXISTS (… base_number = … AND brand = …)` — always use the logical key. Two unrelated rows can share integer `id`; no two distinct bearings should share `(base_number, brand)`.

### 3. Explicit filter on validation status

`WHERE validation_status IN ('valid', 'partial')` on every branch that pulls from `catalog_rows` (matches the committed view in `ai-kb/migrations/0004_catalog_master_view.sql`). The bot must never see `invalid`, `quarantined`, or `error` rows.

### 4. Column list preserved

When extending the view, add columns at the tail. Do not reorder — `ai-kb/src/index.js:catalogRowToText` reads by name, but other consumers may index by column order via CLI dumps.

## Reject

### Anti-pattern A — raw id union

```sql
-- WRONG: collides on id between catalog and catalog_rows
SELECT id, base_number, brand FROM catalog
UNION ALL
SELECT id, base_number, brand FROM catalog_rows;
```

### Anti-pattern B — promotion keyed on staging id

```sql
-- WRONG: re-approving a staging row re-inserts
INSERT INTO catalog_rows SELECT * FROM staging_catalog_import s
WHERE s.status = 'approved' AND s.id NOT IN (SELECT staging_id FROM catalog_rows);
```
Correct: key on `(base_number, brand, source_file_id)` with `NOT EXISTS`.

### Anti-pattern C — view without validation filter

```sql
-- WRONG: quarantined rows leak into bot answers
CREATE VIEW catalog_master_view AS SELECT * FROM catalog_rows;
```

### Anti-pattern D — direct bot read from staging

```js
// WRONG: staging is a review buffer, not an answer source
env.DB.prepare('SELECT * FROM staging_catalog_import WHERE …');
```

### Anti-pattern E — silent legacy override

A new view that surfaces both legacy `catalog` and `catalog_rows` without any dedupe clause. Users see two conflicting prices/quantities for the same bearing.

## Rollback plan for view changes

- Keep the previous view definition as a commented block in the migration footer for one release.
- If the new view shape misfires in prod, applying a follow-up migration that `CREATE VIEW IF NOT EXISTS` with the same name will fail — you must `DROP VIEW` first. Document this in the migration comment.
- Smoke-test after deploy:
  ```bash
  npx wrangler d1 execute baza --remote \
    --command "SELECT COUNT(*) AS n, SUM(validation_status='valid') AS valid FROM catalog_master_view"
  ```
