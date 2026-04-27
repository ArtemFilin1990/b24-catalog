---
name: database-optimizer
description: D1 + Vectorize performance and shape — query patterns, FTS5 vs LIKE fallback, index coverage, FK pragma, vector dim/metadata discipline. Sized for the b24-catalog/ai-kb stack, not generic Postgres.
---

Use this skill when the change touches:

- any new SQL `SELECT` / `INSERT` / `UPDATE` / `DELETE` in `src/index.js` or `ai-kb/src/*.js`
- `migrations/*.sql` or `ai-kb/migrations/*.sql` (CREATE TABLE/VIEW/INDEX, ALTER TABLE)
- a new index, new FK, new GLOB / LIKE / FTS5 MATCH query
- `env.VECTORIZE.upsert` / `query` / `getByIds` / `describe` callsites
- the `searchCatalog` (FTS5 + LIKE fallback) or `searchKnowledge` (Vectorize) helpers
- bulk operations (reindex, ingest) — anything that loops on D1

Pairs with `d1-migration-safety` (which reviews migration safety + idempotency) and `catalog-import-review` (which reviews the staging→catalog_rows pipeline shape).

## D1 reality check (not Postgres, not generic SQLite)

- **D1 = SQLite + serverless networking.** Each `prepare/.bind/.run` is one round trip. `env.DB.batch([...])` is one round trip for many statements — use it whenever you're doing >2 dependent writes.
- **No FK enforcement by default.** D1 ignores `FOREIGN KEY ... REFERENCES ...` unless `PRAGMA foreign_keys = ON` is set on the connection. Migrations 0002+ set it at the top; runtime code does not. So FKs are documentation-only at chat time. **Don't rely on cascade for runtime cleanup.**
- **No `EXPLAIN ANALYZE`.** Use `EXPLAIN QUERY PLAN ...` from `wrangler d1 execute baza --remote --command "..."` and look for `SCAN TABLE` (bad — table scan) vs `SEARCH TABLE ... USING INDEX` (good).
- **No `CONCURRENTLY` for indexes.** D1 `CREATE INDEX` is fast on the row counts we have (≤60k catalog, ≤300k KB chunks). If you ever cross ~1M rows, schedule a maintenance window.
- **No `gen_random_uuid()`.** Use `crypto.randomUUID()` in JS, then `bind` the literal — D1 doesn't have a UUID function.
- **No partial unique indexes via WHERE.** SQLite supports `CREATE UNIQUE INDEX ... WHERE ...` but D1's planner sometimes ignores them. Verify with `EXPLAIN QUERY PLAN`.
- **`AUTOINCREMENT` is rarely needed.** Plain `INTEGER PRIMARY KEY` already auto-increments via rowid. AUTOINCREMENT just adds a write to `sqlite_sequence`.

## Hard rules

- **`?` placeholders + `.bind()`. Always.** Never string-concat user input into SQL. Verify the diff with `grep -n "${"` in any `.prepare(\`...\`)` call.
- **Index every column referenced in `WHERE`, `ORDER BY`, or `JOIN ON`.** Especially for tables we read on the chat hot path: `chat_sessions(client_id, updated_at)`, `chat_messages(session_id)`, `users(username)`, `user_sessions(token)`, `rate_limit(bucket, window_start)`, `knowledge_base(category)`, `query_log(created_at)`. Missing index → `SCAN TABLE` → multi-second chat latency on a populated DB.
- **No `SELECT *`.** Name the columns you actually use. The `migrations/*.sql` are the source of truth; `SELECT *` in code breaks the moment a column is added.
- **No `LIKE '%foo%'` on hot tables.** Leading wildcard = full scan. Use FTS5 (`catalog_fts`, `kb_fts`) or restructure the query. `searchCatalog` already has FTS5 with a LIKE fallback for fresh DBs — don't undo the fallback, but don't add new LIKE-only paths either.
- **Vector IDs match `kb-${kb_id}-${chunk}`.** Stable across re-embed. If you change the format, you orphan every existing vector. Plan a full reindex.
- **Vector dim is 1024 (`EMBED_DIMS`).** `bge-m3` outputs 1024. Filter rows where `values.length === EMBED_DIMS` before upserting; partial vectors poison `query()` results silently.
- **D1 result shape**: `await prep.all()` returns `{ results, success, meta }`. `await prep.first()` returns the first row OR `null` (not `undefined`). `await prep.run()` returns `{ success, meta: { last_row_id, changes, duration } }` for INSERT/UPDATE/DELETE. Check the right field for the right operation.
- **`last_row_id` is per-statement.** Inside `batch([...])` you don't get a per-statement last_row_id reliably — INSERT then SELECT in two separate calls if you need the id.
- **No N+1.** If you're looping in JS to fetch related rows, rewrite as one query with `IN (?, ?, …)` or a JOIN. The repo has none today; keep it that way.

## FTS5 specifics

- **`catalog_fts` is not committed.** `searchCatalog` tries the FTS query first and falls back to `LIKE` if `catalog_fts` doesn't exist (`no such table`). On a fresh D1 we run on LIKE. To rebuild FTS, see `docs/RUNBOOK.md` (TODO if missing). Don't remove the LIKE fallback without first committing the FTS migration.
- **`kb_fts` is committed** in `ai-kb/migrations/0001_initial.sql`. Use `MATCH` for queries, `INSERT INTO kb_fts(rowid, ...)` for sync. `searchKnowledge` does NOT use it directly — it uses Vectorize. The FTS exists for future LIKE-style fallback if Vectorize is unavailable.
- **FTS5 tokenizer**: default `unicode61` handles Cyrillic correctly. Don't override to `porter` (English-only) by accident.

## Vectorize specifics

- **`env.VECTORIZE.query(vec, { topK, returnMetadata: 'all' })`** returns `{ matches: [{ id, score, metadata }] }`. We pass `returnMetadata: 'all'` to get title/content/source/category — needed by `buildContext` to wrap `category='web'` rows in UNTRUSTED delimiters. Don't drop it.
- **`env.VECTORIZE.getByIds([id])`** returns the vector(s). Used by `autoIngestWebHits` to verify a vector survived the prior INSERT (repair-on-skip). On failure (network blip), assume missing and re-upsert — Vectorize upsert is idempotent by ID.
- **`env.VECTORIZE.describe()`** returns `{ vectorCount, ... }`. Used by `/api/stats`. Cheap; OK on every request.
- **`upsert` is idempotent on ID.** Re-running with the same `id` overwrites with new metadata + values. No dedup logic needed in code.
- **CPU budget.** `bge-m3` on a 1200-char chunk uses real CPU. `REINDEX_CHUNKS_PER_CALL = 12` is the empirically-chosen ceiling that doesn't hit `1102 CPU exceeded`. Don't raise without benchmarking on the largest `knowledge_base.content` row (currently 300k chars).

## Query review template

When reviewing a new query, list (one line each):

- **Tables read/written**, with row counts (cite `SELECT COUNT(*)` if non-trivial).
- **Indexes the planner can use** for each WHERE/ORDER BY column. If none, propose the index in the same PR.
- **Estimated round trips**: 1 call, batch, or N+1.
- **Failure mode**: what happens if the table is missing (fresh DB), the column is missing (migration not applied), the row is missing.
- **Hot path?** Used in `/api/chat`'s Promise.all? Then it must be <300ms p99.

## Output contract

```
Decision: APPROVE | APPROVE WITH FIXES | REQUEST CHANGES

Why:
- <perf or correctness driver, with concrete row count or query plan citation>

Blocking fixes:
- <file:line — concrete schema/query change, with migration hint if needed>

Non-blocking improvements:
- <file:line — concrete change>

Merge recommendation:
- <squash | rebase | hold for migration order>
```

If the change requires a new migration, name the file (next free `NNNN_*.sql`) and remind the maintainer of the apply-before-deploy rule (see `references/d1-quirks.md`).
