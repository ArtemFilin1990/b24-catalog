# D1 quirks — what bites you in this codebase

Notes that are too specific for general SQLite docs and too painful to
re-discover from the symptom. Append when you hit a new one.

## FK enforcement

D1 ignores `FOREIGN KEY` constraints unless `PRAGMA foreign_keys = ON` is set
on the connection. Our migrations set it inside the migration files (so the
DDL executes with FKs honoured for the migration session), but **runtime
worker code does not set the pragma**, so cascade deletes and FK validation
do nothing at chat time.

Practical impact:
- `ON DELETE CASCADE` on `user_sessions(user_id) → users(id)` is
  documentation-only at runtime. Deleting a user does NOT delete their
  sessions. Either rely on the row-by-row cleanup we already do
  (`revokeToken`, `DELETE … WHERE user_id = ?`), or set the pragma in code
  before the cascading DELETE.
- `kb_chunks` references `files(id)` — same caveat.
- `chat_messages.session_id` has no declared FK; cleanup relies on
  `handleSessions` DELETE doing both tables in a `batch`.

Don't rely on FK cascades for runtime cleanup. Set the pragma on the
connection or do explicit batched deletes.

## ALTER TABLE ADD COLUMN idempotency

D1's SQLite supports `ALTER TABLE ADD COLUMN`, but it's NOT idempotent —
running it twice fails with "duplicate column". Mitigation we use:
`PRAGMA table_info(<table>)` first, then `ALTER TABLE` only if the column is
missing. See `ai-kb/src/index.js` `ensureAuthTables` for the pattern.

Don't put `ALTER TABLE ADD COLUMN` directly in a migration that might run
twice — wrap in a check, or only ship the migration once.

## `last_row_id` inside `batch`

`env.DB.batch([…]).meta.last_row_id` is unreliable across statements — it
returns a value, but it's the last statement's `last_row_id`, not a per-row
mapping. If you need the `id` of an INSERT to use in a subsequent INSERT,
do it in two separate calls (INSERT then read), or use a UUID generated in
JS.

## No FTS in committed migrations

`catalog_fts` is referenced by `searchCatalog` but is NOT created by any
committed migration. `searchCatalog` tries `MATCH` first, falls back to
`LIKE` on "no such table" error.

If you delete the LIKE fallback, you must also commit the migration that
creates `catalog_fts` AND ensure it's applied before the worker deploys
that depends on it. Otherwise fresh-DB chat is broken.

`kb_fts` IS in `ai-kb/migrations/0001_initial.sql` — ready to use, but
nothing currently queries it (we use Vectorize). Leave it; it's the
future fallback if Vectorize goes down.

## Apply-before-deploy

Several incidents (PR #47 hot fix, the auth `no such table: users` outage)
were caused by deploying a worker that depends on a new migration before
the migration ran. Process:

1. Apply migration: `npx wrangler d1 execute baza --remote --file=…`
2. Verify: `SELECT type, name FROM sqlite_master ORDER BY name`
3. Then push to `main` (which triggers `deploy-ai-kb.yml`).

OR ship a self-heal in the worker (the `ensureAuthTables` pattern) so
either order works. Self-heal is the wart-of-record per CLAUDE.md.

`schema_migrations` is a partial record. Some ai-kb migrations (0005, 0006,
0007) DO `INSERT OR IGNORE INTO schema_migrations`, but the older ai-kb
migrations (0001–0004) don't — they're idempotent-by-shape only
(`CREATE TABLE IF NOT EXISTS`). Both root migrations (0001, 0002) insert.

So `SELECT version FROM schema_migrations` is a useful but incomplete
view. For an authoritative ai-kb schema check, query objects directly:
`SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`.

When you add a new migration, follow the new convention: end the file with
`INSERT OR IGNORE INTO schema_migrations (version) VALUES ('NNNN_name');`
so the table converges to a complete record over time.

## `prepare()` cache and parameter limits

D1 caches prepared statements per worker instance. There's a SQLite
parameter limit (~999 by default for `?` placeholders). If you build a
giant `IN (?, ?, …)` clause, batch into chunks of 500.

## `DATETIME DEFAULT CURRENT_TIMESTAMP` returns UTC

D1 stores timestamps in UTC. Frontend code that parses them must append
'Z': `new Date(iso.replace(' ', 'T') + 'Z')`. See
`ai-kb/public/app.js:fmtRowTime` for the pattern.

## Vectorize ID format must be stable

Our IDs are `kb-${kb_id}-${chunk}`. If you change the format (e.g. switch
to UUID), you orphan every existing vector — `searchKnowledge` keeps
returning old vectors that no longer have a corresponding `knowledge_base`
row. Plan a full reindex in the same PR.
