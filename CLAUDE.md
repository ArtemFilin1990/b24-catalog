# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Local skills

Prefer the local skills in `.claude/skills/` before generic reasoning when the task matches:

- `.claude/skills/kb-audit` — review PRs, migrations, D1 schema safety, scope drift, and merge risk.
- `.claude/skills/bearing-analog-check` — validate bearing type/series/geometry logic and enforce `NO DIRECT EQUIV` when exact matches are absent.
- `.claude/skills/catalog-import-review` — review catalog import/staging/view logic, normalized rows, duplicate prevention, and migration bootstrap safety.
- `.claude/skills/cloudflare-worker-review` — review Worker routes, secrets, bindings, deploy flow, Cloudflare-specific risks, and admin/auth hardening.
- `.claude/skills/d1-migration-safety` — review D1 migration bootstrap safety, upgrade safety, helper-table dependencies, id/view collisions, and clean-db behavior.

When a task touches PR review, migrations, Cloudflare worker behavior, admin/auth flow, bearing analog logic, import/staging SQL, or catalog read models, load and follow the matching local skill first.

## Repo shape

Cloudflare mono-repo with **two workers** sharing the same D1 + R2 backing store:

| Worker | Dir | Prod URL | What it is |
|---|---|---|---|
| `b24-catalog` | `./src`, `./public`, `./wrangler.toml` | `b24-catalog.35ewerest.workers.dev` | Bearings catalog: static HTML + `/api/imports`, `/api/orders`, `/api/ask` (Llama 3.1 8B), `catalog.gz` from R2, D1→R2 nightly backup via cron `0 3 * * *`. |
| `ai-kb` | `./ai-kb` | `ai-kb.35ewerest.workers.dev` | "Бот Эверест" chat UI: SSE streaming chat with RAG (D1 FTS + Vectorize), editable system prompt, image attachments (vision), file ingestion, session history. |

Shared bindings: D1 `baza` (id `11a157a7-c3e0-4b6b-aa24-3026992db298`), R2 `vedro` bucket, Workers AI, Vectorize `ai-kb-index` (1024 dim, cosine). Account `84cbacc4816c29c294101ec57a0bea5d`.

Everything server-side is vanilla Workers JS — **no bundler, no TypeScript, no build step, no package.json**. Edit `.js` / `.html` / `.css` directly, `wrangler deploy` ships it.

## Commands

```bash
# Deploy root worker (from repo root)
npx wrangler deploy

# Deploy ai-kb worker (must cd into subdir — its own wrangler.toml)
cd ai-kb && npx wrangler deploy

# Apply D1 migrations (idempotent — IF NOT EXISTS)
# Run in this order on a fresh DB:
npx wrangler d1 execute baza --remote --file=migrations/0001_root_schema.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0001_initial.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0002_files_rules_catalog.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0003_catalog_staging.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0004_catalog_master_view.sql

# Inspect applied state. `schema_migrations` only records the root
# migration(s); ai-kb migrations are idempotent-by-shape and do not
# insert into that table, so cross-check by listing actual objects:
npx wrangler d1 execute baza --remote --command "SELECT version, applied_at FROM schema_migrations"
npx wrangler d1 execute baza --remote --command "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"

# Set secrets (never commit them)
echo "$TOKEN" | npx wrangler secret put ADMIN_TOKEN
cd ai-kb && echo "$TOKEN" | npx wrangler secret put ADMIN_TOKEN

# After a secret change on a deployed worker, wrangler may refuse with
# "latest version isn't currently deployed" — use:
echo "$TOKEN" | npx wrangler versions secret put ADMIN_TOKEN
npx wrangler versions deploy <version_id> -y

# Tail logs
npx wrangler tail b24-catalog
cd ai-kb && npx wrangler tail ai-kb

# No tests in this repo. Smoke-test via curl:
curl -s https://ai-kb.35ewerest.workers.dev/api/health
curl -s -X POST https://b24-catalog.35ewerest.workers.dev/api/backup -H "X-Admin-Token: $ADMIN_TOKEN"
```

Wrangler version: pin to `4.83.0` for ai-kb GHA; elsewhere `wrangler@latest` is fine. Auth via `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env vars.

## Deployment: DO NOT rely on Cloudflare's native Git integration for ai-kb

Cloudflare's native Git integration builds the **root** `wrangler.toml` (b24-catalog) on every push and has historically clobbered the `ai-kb` worker by pushing the root bundle into it. Native CI for ai-kb is disabled at the account level (`DELETE /accounts/.../workers/services/ai-kb/environments/production/build-trigger`).

Deploy flow:

- `b24-catalog` → Cloudflare native Git integration (on push to `main`).
- `ai-kb` → **only** `.github/workflows/deploy-ai-kb.yml`. It:
  - Runs on every push to `main` and on a `*/15 * * * *` cron as a self-heal.
  - Has a pre-flight step that hits `/accounts/{id}/tokens/verify` — **not** `/user/tokens/verify` (account-scoped tokens fail the user-scoped endpoint with `code 1000` even when valid).
  - Runs `wrangler deploy` + verify-title-retry loop (up to 6 attempts, 30/60/90/120/150/180s backoff) to beat any stray CF auto-deploy.
  - Smoke-checks `<title>Бот Эверест</title>` and `/api/health` returning `llama-3.3-70b`.

If you touch this workflow, keep the retry loop and pin `wrangler@4.83.0` in the `npm i -g` step. If ai-kb ever regresses to the catalog HTML, check that the build-trigger is still deleted for the ai-kb service — it may have been re-enabled from the dashboard.

## Admin auth + audit (root worker)

`src/index.js` has a tight auth model. **Do not reintroduce hardcoded tokens** (the upload endpoint used to have one — it's in git history, rotate any token that ever lived there).

- `requireAdmin(request, env)` — accepts `X-Admin-Token` or `Authorization: Bearer …`, matched against `env.ADMIN_TOKEN` with `safeEqual` (constant-time compare). Use for privileged endpoints: `POST /api/backup`, `GET /api/orders`, `DELETE /api/imports/:id`, `POST /api/imports`, `GET /api/sessions`, `GET /api/admin/audit`.
- `requireUpload(request, env)` — admin OR legacy `X-Upload-Token` matched against `env.ADMIN_UPLOAD_TOKEN`. **Use only** for `POST /api/admin/upload-catalog`. Do NOT broaden — the upload token is deliberately narrow-scope so a leak doesn't escalate.
- `audit(env, request, action, resource, meta)` — fire-and-forget INSERT into `admin_audit_log`. Always call via `ctx.waitUntil(audit(...))` so the response returns before the log write. Schema is in `migrations/0001_root_schema.sql`; don't add lazy `CREATE TABLE` in code.

`GET /api/imports` stays public (it's the catalog feed consumed by `public/index.html`). `POST /api/orders` is also intentionally public — customers submit their own contact info from the order form, so requiring a token there would break the UX; input validation only. Everything that **reads** PII or writes to shared state is admin-gated: `GET /api/orders`, `POST /api/imports`, `DELETE /api/imports/:id`, `GET /api/sessions`, `POST /api/backup`, `GET /api/admin/audit`. The inline `<script id="ev-d1-sync">` in `public/index.html` has an `adminFetch` helper that prompts for the token (stored in `sessionStorage`, key `ev_admin_token`) and retries once on 401 — keep that pattern when adding new admin-only calls from the frontend.

**ai-kb has its own `requireAdmin`.** `ai-kb/src/index.js` ships a simpler variant (lines ~115–119): `X-Admin-Token` header only, plain `===` compare, no `Bearer` support, no `safeEqual`. Both workers read `env.ADMIN_TOKEN`, but the tokens are stored as separate secrets per worker. If you add a new admin-gated ai-kb route, use the existing `requireAdmin(request, env)` in that file; do **not** import or mirror the root-worker helper (the two workers deploy independently).

## ai-kb architecture

Single-file `ai-kb/src/index.js` (~740 lines). Request flow:

`ai-kb/src/index.js` dispatches chat/search/stats/settings; the admin file registry lives in `ai-kb/src/files.js` and is imported at the top (`handleAdminFilesUpload`, `handleAdminFilesList`, `handleAdminFilesDelete`, `handleAdminStorageStats`). The file module receives `{ jsonOk, jsonErr, requireAdmin }` as helpers so both workers share the same error and auth shape without cross-worker imports.

1. **`POST /api/chat`** — SSE stream. Pulls overrides from the `settings` D1 table in a *single* query (not per-key) using `??` for null-coalescing (so `catalog_topk = 0` actually disables catalog RAG). Searches in parallel:
   - D1 FTS via `catalog_fts` virtual table if present — `searchCatalog` tries the FTS query first and falls back to a plain LIKE if the table isn't there. FTS is not created by the committed migrations, so a fresh DB runs on LIKE until you rebuild FTS manually.
   - Vectorize semantic search (`bge-m3` 1024-dim embeddings, `searchKnowledge`)
2. If the request carries `images: [{name, dataUrl}]`, each image is first passed through `@cf/meta/llama-3.2-11b-vision-instruct` to get a text description (`describeImage`), then the description is spliced into the user message. The vision pass is synchronous and *before* the streaming chat, so it delays first-token time.
3. The assembled user message is `[context] + [attachment_text] + [image descriptions] + [question]`; the RAG context uses **only the pure question** so attachment text doesn't poison the FTS/vector query.
4. Chat runs on `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (switched from 8B — 8B couldn't reliably distinguish bearing types under RAG noise). `stream.tee()` is used so the response streams to the client while a second copy is consumed to persist the assistant message to D1.

**Prompt is not just in code.** `AI_SYSTEM` is the factory default; the live prompt comes from `settings.system_prompt` in D1 if set. Same for `temperature`, `max_tokens`, `catalog_topk`, `vector_topk`. Admins edit via `POST /api/settings` and the gear icon in the UI. Don't hardcode prompt changes — adjust `AI_SYSTEM` only for the compile-time default, and understand that production may be overriding it.

**Reindex budget.** `/api/reindex?after_id=N&chunk_from=M` is intentionally tiny per call (`REINDEX_CHUNKS_PER_CALL = 12`) because `@cf/baai/bge-m3` on a 1200-char chunk eats CPU; higher values hit `1102 CPU exceeded`. Client loops the call. Don't raise the constant without benchmarking on the largest KB row (the `knowledge_base.content` column has a 300k-char row).

**Worker-level deletion risk.** `DELETE /workers/services/ai-kb/environments/production/build-trigger` on the CF API removes the **whole worker**, not just the build trigger. Found out the hard way — if the worker evaporates, `cd ai-kb && wrangler deploy` recreates it but secrets (`ADMIN_TOKEN`) need to be re-put.

## D1 schema layout

Canonical in `migrations/*.sql` — grep the file before writing a query. Fresh apply order: root `0001_root_schema.sql`, then `ai-kb/migrations/0001…0004`. Current objects:

- **Legacy catalog** (root `0001`) — `catalog` (~58k bearings, read-only in ai-kb), `imported_rows`, `import_sessions`, `orders`. This is what `/api/imports`, `/api/orders`, `/api/ask` use. No FTS table committed — the `catalog_fts` referenced by `ai-kb/src/index.js:searchCatalog` is runtime-optional and only exists if someone created it out-of-band.
- **ai-kb content** (ai-kb `0001`) — `knowledge_base` + `kb_fts` FTS5 + `chat_sessions`, `chat_messages`, `query_log`. The `settings` key-value table is created lazily by `ensureSettingsTable` in code, not in a migration — treat that as a wart.
- **File ingest + normalized catalog** (ai-kb `0002`) — `files` (original R2 objects), `file_extracts` (per-page/sheet text + OCR), `kb_chunks` (FK→files, `ON DELETE CASCADE`; requires `PRAGMA foreign_keys = ON`), `bearing_rules` + `bearing_rule_mappings` (knowledge extracted from PDFs), `catalog_rows` + `catalog_row_issues` (normalized from xlsx/csv), `jobs`, `admin_audit_log`, `cleanup_log`.
- **Staging** (ai-kb `0003`) — `staging_catalog_import` (review buffer for catalog imports).
- **Read model** (ai-kb `0004`) — `catalog_master_view` VIEW over `catalog_rows` filtered by validation status; read path for the bot should prefer this over the legacy `catalog` table once populated.
- **Ops** — `admin_audit_log`, `schema_migrations`. Only the root `0001` inserts a row into `schema_migrations`; the ai-kb migrations are idempotent by shape (`CREATE TABLE IF NOT EXISTS`) and do **not** record a row there. So `SELECT version FROM schema_migrations` only reflects root state. To verify ai-kb state, inspect objects directly: `SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`.

D1 does not enforce foreign keys by default — any FK cascade depends on `PRAGMA foreign_keys = ON` being set for the connection. Migration 0002 sets it at the top; runtime code does not.

## Frontend conventions (ai-kb)

`ai-kb/public/app.js` is plain IIFE ES5-ish, no bundler, no framework. Key patterns:

- Admin token lives in `sessionStorage['ai-kb-admin']` (not `localStorage` — XSS blast radius). Prompted on demand via `adminFetch` wrapper with 401 auto-retry.
- Chat state is in-memory only (`let messages = []`). Attachments go as a **separate** `attachment_text` / `images` payload, never merged into the chat-history `content` string — the server relies on that separation for clean RAG queries.
- File extraction happens client-side: `extractPdf` (pdf.js CDN), `extractDocx` (mammoth CDN), `extractXlsx` (SheetJS CDN — flattens each sheet to CSV with `# <SheetName>` header). `looksBinary()` rejects files that decode to >3% replacement/control chars so users don't upload mojibake.
- Bot responses are streamed as plain text while typing, then `renderMarkdown()` rewrites the bubble on stream end — it parses pipe tables, bullet lists, `**bold**`, `` `code` `` into actual HTML (no external markdown lib).

## Operational notes

`docs/RUNBOOK.md` is the ops source of truth (secrets rotation with history of known leaks, migration order, deploy procedure, smoke tests, audit log read, P1/P2 backlog). Read it before any ops-facing change.

When editing secrets or creating resources, preserve idempotence — this repo gets redeployed a lot, and scripts that create-only-if-missing survive while destructive ones don't.
