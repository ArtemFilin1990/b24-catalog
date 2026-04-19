# View and id rules

Two catalog-like tables exist in D1 `baza` and can overlap logically:

- `catalog` — legacy, populated by the root worker's `/api/admin/upload-catalog` + imports. ~58k rows of real stock.
- `catalog_rows` — normalized rows produced by the ai-kb import pipeline (xlsx/csv → `file_extracts` → `catalog_rows`).

Both have an integer `id`, but those ids are independent sequences. A read model that unions them must **not** treat raw `id` as globally unique.

## Preferred patterns

### 1. Stable uid when sources overlap

```sql
DROP VIEW IF EXISTS catalog_master_view;
CREATE VIEW catalog_master_view AS
SELECT
  'catalog_rows:' || cr.id AS uid,
  cr.base_number, cr.brand, cr.type, cr.d_inner, cr.d_outer, cr.width_mm,
  cr.skf_analog, cr.fag_analog, cr.nsk_analog, cr.ntn_analog, cr.zwz_analog,
  cr.seal, cr.clearance, cr.price_rub, cr.qty
FROM catalog_rows cr
WHERE cr.validation_status IN ('valid', 'partial')
UNION ALL
SELECT
  'catalog:' || c.id AS uid,
  c.base_number, c.brand, c.type, c.d_inner, c.d_outer, c.width_mm,
  c.skf_analog, c.fag_analog, c.nsk_analog, c.ntn_analog, c.zwz_analog,
  c.seal, c.clearance, c.price_rub, c.qty
FROM catalog c
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_rows cr2
  WHERE cr2.validation_status IN ('valid', 'partial')
    AND cr2.base_number = c.base_number
    AND cr2.brand       = c.brand
);
```

Rules:

- `uid` uses a source prefix so consumers can dedupe across views.
- `UNION ALL` is cheaper than `UNION` in D1; deduplicate with `NOT EXISTS` on a stable business key (`base_number, brand`).
- Read models for the bot/search (`catalog_master_view`) must filter invalid/quarantined rows (`validation_status = 'valid'`).

### 2. Staging → normalized promotion

```sql
INSERT INTO catalog_rows (base_number, brand, type, …, validation_status, source_file_id)
SELECT s.base_number, s.brand, s.type, …, 'valid', s.file_id
FROM staging_catalog_import s
WHERE s.reviewed_at IS NOT NULL
  AND s.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM catalog_rows cr
    WHERE cr.base_number = s.base_number
      AND cr.brand       = s.brand
      AND cr.source_file_id = s.file_id
  );
```

Rules:

- Promote only **reviewed + approved** staging rows.
- Use `NOT EXISTS` with a stable business key — never the raw integer `id`.
- After promotion, update the staging row's `promoted_at` so the next batch skips it.

### 3. Vector id namespacing

- `knowledge_base` chunks → `kb-<kb_id>-<chunk>`.
- Do not reuse the `kb-` prefix for any other source. If you add a second source (e.g. files KB), use `file-<file_id>-<chunk>`.
- Filter embeddings by length (`values.length === EMBED_DIMS`) before `VECTORIZE.upsert`.

## Anti-patterns to reject in review

- `SELECT id, … FROM catalog UNION ALL SELECT id, … FROM catalog_rows` → collisions on `id`.
- `DISTINCT` across union without a business key → still non-deterministic.
- Staging promotions that key on raw `id` only → double-promotion on replay.
- Read model that does not filter invalid rows → the bot recommends quarantined data.
- Vector ids without a source prefix.
