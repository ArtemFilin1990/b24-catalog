# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Local skills

This repo ships nine playbooks in `.claude/skills/` that encode hard-won repo-specific rules. An agent must load the matching skill **before** generic reasoning when the task trigger below applies. The layout, composition rules, and decision tree live in [`.claude/skills/README.md`](.claude/skills/README.md) — read that when adding, removing, or renaming a skill.

- [`.claude/skills/kb-audit`](.claude/skills/kb-audit) — top-level PR review: scope discipline, merge-decision matrix, composes the specialist review skills below.
- [`.claude/skills/cloudflare-worker-review`](.claude/skills/cloudflare-worker-review) — Worker routes, bindings, secrets, admin/upload auth, audit coverage, and the `deploy-ai-kb.yml` hardening invariants.
- [`.claude/skills/d1-migration-safety`](.claude/skills/d1-migration-safety) — bootstrap/upgrade safety, FK pragma, `schema_migrations` semantics, view-uid and dedupe rules.
- [`.claude/skills/catalog-import-review`](.claude/skills/catalog-import-review) — R2 → `files` → `file_extracts` → staging → `catalog_rows` → `catalog_master_view` pipeline, duplicate prevention, bot read path.
- [`.claude/skills/bearing-analog-check`](.claude/skills/bearing-analog-check) — type/series/geometry rules for bearing analogs, status vocabulary, ГОСТ ↔ ISO traps, commercial-data boundary.
- [`.claude/skills/security-engineer`](.claude/skills/security-engineer) — adversarial review (STRIDE, prompt-injection, secret hygiene) sized for this Workers + D1 + Vectorize stack; references known leaked-token + KB-poisoning incidents.
- [`.claude/skills/sre`](.claude/skills/sre) — SLOs, error budgets, hot-path latency budget, deploy retry/cron safety; companion to the runbook in `docs/RUNBOOK.md`.
- [`.claude/skills/database-optimizer`](.claude/skills/database-optimizer) — D1 + Vectorize query patterns, index coverage, FTS5 vs LIKE fallback, vector dim/metadata discipline.
- [`.claude/skills/ai-kb-chatbot-build`](.claude/skills/ai-kb-chatbot-build) — the single generative skill: extend or fix the live `ai-kb` chatbot with D1 memory, Vectorize RAG, R2 ingest, admin settings, and safe bearing answers.

Each skill directory has the same shape: `SKILL.md` (frontmatter + workflow + output contract), `references/*.md` (authoritative rule sheets), `scripts/*.sh` (static checks or a smoke test). Run the relevant script — they are offline except for `ai-kb-chatbot-build/scripts/smoke_chat.sh`.

When a task touches PR review, migrations, Cloudflare worker behavior, admin/auth flow, bearing analog logic, import/staging SQL, catalog read models, or building/extending the Everest chatbot, **load the matching local skill first** and follow its checklist.

## Donor reference packs

`skill-packs/` holds third-party/donor material that is **not** production code. Treat it as reading-only background when tuning prompts or validating bearing logic:

- `skill-packs/ewerest-ai-chatbot/` — an earlier standalone chatbot design. Useful donor material is in `references/bearing-rules.md` and `references/system-prompt.md`. The package's `src/`, `scripts/d1_schema.sql`, `scripts/seed_catalog.py` and `wrangler-template.toml` conflict with the live `ai-kb` worker and live D1 schema — **do not copy them into `src/` or `ai-kb/src/`**. See `skill-packs/ewerest-ai-chatbot/INTEGRATION.md` for the file-by-file mapping and rejected items.

## Repo shape

Cloudflare mono-repo with **two workers** sharing the same D1 + R2 backing store:

| Worker | Dir | Prod URL | What it is |
|---|---|---|---|
| `b24-catalog` | `./src`, `./public`, `./wrangler.toml` | `b24-catalog.35ewerest.workers.dev` | Bearings catalog: static HTML + `/api/imports`, `/api/orders`, `/api/ask` (Llama 3.1 8B), `catalog.gz` from R2, D1→R2 nightly backup via cron `0 3 * * *`. |
| `ai-kb` | `./ai-kb` | `ai-kb.35ewerest.workers.dev` | "Бот Эверест" chat UI: SSE streaming chat with RAG (D1 FTS + Vectorize), editable system prompt, image attachments (vision), file ingestion, session history. |

Shared bindings: D1 `baza` (id `11a157a7-c3e0-4b6b-aa24-3026992db298`), R2 `vedro` bucket (binding name `CATALOG` in both workers — **not** `R2`), Workers AI, Vectorize `ai-kb-index` (1024 dim, cosine). Account `84cbacc4816c29c294101ec57a0bea5d`.

Everything server-side is vanilla Workers JS — **no bundler, no TypeScript, no build step, no package.json**. Edit `.js` / `.html` / `.css` directly, `wrangler deploy` ships it.

The two workers deploy independently but share two helper files by **byte-for-byte duplication**, not import: `src/ratelimit.js` and `ai-kb/src/ratelimit.js`. If you change one, change the other; both back the same `rate_limit` D1 table from root `migrations/0002_rate_limit.sql`.

## Commands

```bash
# Deploy root worker (from repo root)
npx wrangler deploy

# Deploy ai-kb worker (must cd into subdir — its own wrangler.toml)
cd ai-kb && npx wrangler deploy

# Apply D1 migrations (idempotent — IF NOT EXISTS / INSERT OR IGNORE)
# Run in this order on a fresh DB:
npx wrangler d1 execute baza --remote --file=migrations/0001_root_schema.sql
npx wrangler d1 execute baza --remote --file=migrations/0002_rate_limit.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0001_initial.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0002_files_rules_catalog.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0003_catalog_staging.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0004_catalog_master_view.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0005_settings.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0006_chat_client_id.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0007_users_auth.sql

# Inspect applied state. Root `0001`, root `0002`, and ai-kb `0005`–`0007`
# all `INSERT OR IGNORE INTO schema_migrations`; ai-kb `0001`–`0004` are
# idempotent-by-shape and do NOT record a row. Cross-check object presence:
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

`.github/workflows/external-review.yml` runs Claude Code on PRs from first-time external contributors via `pull_request_target` (so secrets are available). It only leaves comments — never approves, never merges. Don't move it back to `pull_request`; secrets won't be exposed and the workflow will silently no-op.

## Admin auth + audit (root worker)

`src/index.js` has a tight auth model. **Do not reintroduce hardcoded tokens** (the upload endpoint used to have one — it's in git history, rotate any token that ever lived there).

- `requireAdmin(request, env)` — accepts `X-Admin-Token` or `Authorization: Bearer …`, matched against `env.ADMIN_TOKEN` with `safeEqual` (constant-time compare). Use for privileged endpoints: `POST /api/backup`, `GET /api/orders`, `DELETE /api/imports/:id`, `POST /api/imports`, `GET /api/sessions`, `GET /api/admin/audit`.
- `requireUpload(request, env)` — admin OR legacy `X-Upload-Token` matched against `env.ADMIN_UPLOAD_TOKEN`. **Use only** for `POST /api/admin/upload-catalog`. Do NOT broaden — the upload token is deliberately narrow-scope so a leak doesn't escalate.
- `audit(env, request, action, resource, meta)` — fire-and-forget INSERT into `admin_audit_log`. Always call via `ctx.waitUntil(audit(...))` so the response returns before the log write. Schema is in `migrations/0001_root_schema.sql`; don't add lazy `CREATE TABLE` in code.

`GET /api/imports` stays public (it's the catalog feed consumed by `public/index.html`). `POST /api/orders` is also intentionally public — customers submit their own contact info from the order form, so requiring a token there would break the UX; input validation only. Everything that **reads** PII or writes to shared state is admin-gated: `GET /api/orders`, `POST /api/imports`, `DELETE /api/imports/:id`, `GET /api/sessions`, `POST /api/backup`, `GET /api/admin/audit`. The inline `<script id="ev-d1-sync">` in `public/index.html` has an `adminFetch` helper that prompts for the token (stored in `sessionStorage`, key `ev_admin_token`) and retries once on 401 — keep that pattern when adding new admin-only calls from the frontend.

**ai-kb has its own `requireAdmin`.** `ai-kb/src/index.js` ships a smaller variant (around line 166): `X-Admin-Token` header only — no `Authorization: Bearer …` support — but it also uses constant-time `safeEqual` (defined a few lines above at ~158). Both workers read `env.ADMIN_TOKEN`, but the tokens are stored as separate secrets per worker. If you add a new admin-gated ai-kb route, use the existing `requireAdmin(request, env)` in that file; do **not** import or mirror the root-worker helper (the two workers deploy independently).

**ai-kb user auth (migration 0007).** Beyond admin tokens, `ai-kb/src/auth.js` implements username + password login backed by the `users` and `user_sessions` tables. PBKDF2-SHA256, 100k iterations, 16-byte salt; session token is 32 random bytes hex sent as `Authorization: Bearer <token>` and lives 30 days. After login, the server uses `user.id` as the effective `chat_sessions.client_id` when persisting chats and as the owner id when reading them — there is no anonymous browser-UUID fallback in the current `index.js` (despite what migration 0006's comment suggests; the design evolved during 0007). `GET /api/sessions` is **user-gated, not anonymous**: callers must present `X-Admin-Token` *or* a valid `Authorization: Bearer …`, otherwise the endpoint returns 401. The `?client_id=` query parameter is honored only for admins (to inspect another user's chats); regular users always see their own `user.id` rows. Admins without a filter see all sessions.

## ai-kb architecture

`ai-kb/src/` is a small set of plain ES-module files imported by `index.js`:

| File | Role |
|---|---|
| `index.js` (~1.2k lines) | HTTP dispatcher: chat/search/stats/settings/sessions/auth/admin/reindex. |
| `auth.js` | Username + password (PBKDF2) auth helpers backing migration 0007. |
| `bearings.js` | `extractDimensions(query)` + geometric d×D×B analog lookup over `catalog_master_view` / `catalog`. Used as a deterministic 4th retrieval leg when the user types a size triple. |
| `files.js` | Admin file registry: `handleAdminFilesUpload`, `…List`, `…Delete`, `handleAdminStorageStats`. Receives `{ jsonOk, jsonErr, requireAdmin }` as helpers so it shares the parent's error/auth shape without cross-worker imports. |
| `ratelimit.js` | Fixed-window counter against the D1 `rate_limit` table. **Identical** to `src/ratelimit.js` in the root worker — keep the two files in sync. |
| `web_search.js` | Brave Search wrapper (REST, free tier 2k/mo, 1 QPS). Reads `env.BRAVE_API_KEY`; if unset, returns `[]` so the rest of RAG still works. Snippets capped at 240 chars, top-k hard-capped at 10. |

Request flow for `POST /api/chat` — SSE stream:

1. Pulls overrides from the `settings` D1 table in a *single* query (not per-key) using `??` for null-coalescing (so `catalog_topk = 0` actually disables catalog RAG).
2. Runs retrieval legs in parallel:
   - D1 FTS via `catalog_fts` virtual table if present — `searchCatalog` tries the FTS query first and falls back to a plain LIKE if the table isn't there. FTS is not created by the committed migrations, so a fresh DB runs on LIKE until you rebuild FTS manually.
   - Vectorize semantic search (`bge-m3` 1024-dim embeddings, `searchKnowledge`).
   - Geometric d×D×B match via `bearings.js` only when the message contains **both** a `NN×NN×NN` triple *and* a bearing-type hint (e.g. `6205`, `NU205`, `32205`). The same d×D×B can be a ball, cylindrical-roller, or tapered bearing, so without a type hint the geometric leg is skipped to avoid mixing incompatible analogs.
   - Optional Brave web search (`web_search.js`) when an admin enables it via settings.
3. If the request carries `images: [{name, dataUrl}]`, each image is first passed through `@cf/meta/llama-3.2-11b-vision-instruct` to get a text description (`describeImage`), then the description is spliced into the user message. The vision pass is synchronous and *before* the streaming chat, so it delays first-token time.
4. The assembled user message is `[context] + [attachment_text] + [image descriptions] + [question]`; the RAG context uses **only the pure question** so attachment text doesn't poison the FTS/vector query.
5. Chat runs on `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (switched from 8B — 8B couldn't reliably distinguish bearing types under RAG noise). `stream.tee()` is used so the response streams to the client while a second copy is consumed to persist the assistant message to D1.

**Prompt is not just in code.** `AI_SYSTEM` is the factory default; the live prompt comes from `settings.system_prompt` in D1 if set. Same for `temperature`, `max_tokens`, `catalog_topk`, `vector_topk`, web-search toggles. Admins edit via `POST /api/settings` and the gear icon in the UI. Don't hardcode prompt changes — adjust `AI_SYSTEM` only for the compile-time default, and understand that production may be overriding it.

**Self-heal vs migrations.** The settings table is now created by migration 0005, and users/user_sessions/`chat_sessions.client_id` by 0006/0007. `index.js` still ships an `ensureAuthTables` self-heal that lazily creates those if a deployed worker is running ahead of its D1 — it exists so signup/chat doesn't 500 on a stale DB, **not** as a substitute for running the migrations. Always apply the SQL files for a fresh bootstrap.

**Reindex budget.** `/api/reindex?after_id=N&chunk_from=M` is intentionally tiny per call (`REINDEX_CHUNKS_PER_CALL = 12`) because `@cf/baai/bge-m3` on a 1200-char chunk eats CPU; higher values hit `1102 CPU exceeded`. Client loops the call. Don't raise the constant without benchmarking on the largest KB row (the `knowledge_base.content` column has a 300k-char row).

**Worker-level deletion risk.** `DELETE /workers/services/ai-kb/environments/production/build-trigger` on the CF API removes the **whole worker**, not just the build trigger. Found out the hard way — if the worker evaporates, `cd ai-kb && wrangler deploy` recreates it but secrets (`ADMIN_TOKEN`) need to be re-put.

## D1 schema layout

Canonical in `migrations/*.sql` — grep the file before writing a query. Fresh apply order: root `0001_root_schema.sql` → root `0002_rate_limit.sql` → `ai-kb/migrations/0001…0007`. Current objects:

- **Legacy catalog** (root `0001`) — `catalog` (~58k bearings, read-only in ai-kb), `imported_rows`, `import_sessions`, `orders`, `admin_audit_log`. This is what `/api/imports`, `/api/orders`, `/api/ask` use. No FTS table committed — the `catalog_fts` referenced by `ai-kb/src/index.js:searchCatalog` is runtime-optional and only exists if someone created it out-of-band.
- **Rate limiter** (root `0002`) — `rate_limit (bucket, window_start, count)` shared by both workers. Fixed-window UPSERT counter; sweep stale rows from cron — see `docs/RUNBOOK.md` §cleanup.
- **ai-kb content** (ai-kb `0001`) — `knowledge_base` + `kb_fts` FTS5 + `chat_sessions`, `chat_messages`, `query_log`.
- **File ingest + normalized catalog** (ai-kb `0002`) — `files` (original R2 objects), `file_extracts` (per-page/sheet text + OCR), `kb_chunks` (FK→files, `ON DELETE CASCADE`; requires `PRAGMA foreign_keys = ON`), `bearing_rules` + `bearing_rule_mappings` (knowledge extracted from PDFs), `catalog_rows` + `catalog_row_issues` (normalized from xlsx/csv), `jobs`, `admin_audit_log`, `cleanup_log`.
- **Staging** (ai-kb `0003`) — `staging_catalog_import` (review buffer for catalog imports).
- **Read model** (ai-kb `0004`) — `catalog_master_view` VIEW over `catalog_rows` filtered by validation status; read path for the bot should prefer this over the legacy `catalog` table once populated.
- **Settings** (ai-kb `0005`) — `settings (key, value, updated_at)`. Used to live as a lazy `ensureSettingsTable` in `index.js`; migration 0005 promoted it and seeds defaults (`temperature=0.2`, `max_tokens=900`, `catalog_topk=6`, etc.) via `INSERT OR IGNORE`. Operator overrides survive re-runs.
- **Per-client chats** (ai-kb `0006`) — `chat_sessions.client_id` column + `idx_sessions_client (client_id, updated_at DESC)`. In the current `handleChat` / `handleSessions`, `client_id` is populated with the authenticated `user.id` (the migration's "browser-UUID" comment is stale — the design changed during 0007). The index is what makes `GET /api/sessions` cheap for a given owner.
- **Users** (ai-kb `0007`) — `users (id, username, password_hash, password_salt, …)` + `user_sessions (token, user_id, expires_at)`. Backs `ai-kb/src/auth.js`. Tokens are 32B hex sent as `Authorization: Bearer …`, lifetime 30 days.
- **Ops** — `admin_audit_log`, `schema_migrations`. Migrations that record a row in `schema_migrations`: root `0001`, root `0002`, ai-kb `0005`, `0006`, `0007`. Ai-kb `0001`–`0004` are still idempotent-by-shape and do **not** insert a row, so `SELECT version FROM schema_migrations` underreports them. To verify the full set, list objects: `SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`.

D1 does not enforce foreign keys by default — any FK cascade depends on `PRAGMA foreign_keys = ON` being set for the connection. ai-kb migration 0002 sets it at the top; runtime code does not.

## Frontend conventions (ai-kb)

`ai-kb/public/app.js` is plain IIFE ES5-ish, no bundler, no framework. Key patterns:

- Admin token lives in `sessionStorage['ai-kb-admin']` (not `localStorage` — XSS blast radius). Prompted on demand via `adminFetch` wrapper with 401 auto-retry.
- Chat state is in-memory only (`let messages = []`). Attachments go as a **separate** `attachment_text` / `images` payload, never merged into the chat-history `content` string — the server relies on that separation for clean RAG queries.
- File extraction happens client-side: `extractPdf` (pdf.js CDN), `extractDocx` (mammoth CDN), `extractXlsx` (SheetJS CDN — flattens each sheet to CSV with `# <SheetName>` header). `looksBinary()` rejects files that decode to >3% replacement/control chars so users don't upload mojibake.
- Bot responses are streamed as plain text while typing, then `renderMarkdown()` rewrites the bubble on stream end — it parses pipe tables, bullet lists, `**bold**`, `` `code` `` into actual HTML (no external markdown lib).

## Operational notes

`docs/RUNBOOK.md` is the ops source of truth (secrets rotation with history of known leaks, migration order, deploy procedure, smoke tests, audit log read, P1/P2 backlog). Read it before any ops-facing change.

When editing secrets or creating resources, preserve idempotence — this repo gets redeployed a lot, and scripts that create-only-if-missing survive while destructive ones don't.
