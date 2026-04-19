# ewerest-ai-chatbot — integration status in `b24-catalog`

This package was uploaded as a donor reference for the Everest AI chatbot. The
production architecture in this repo (`b24-catalog` + `ai-kb` workers) already
implements the same problem space with a **different, more developed** schema
and route set, so this package is kept as **reference-only material** under
`skill-packs/`.

**Do not copy `src/` or `scripts/` from this package into `src/` or
`ai-kb/src/`.** Doing so would create a shadow chatbot, overwrite the live
`ai-kb` worker, or introduce a conflicting D1 schema. See the matrix below for
what to use and what to ignore.

Source of truth: see root `CLAUDE.md`, `docs/RUNBOOK.md`, and the code in
`ai-kb/src/` and `src/`.

## Adoption matrix

| Package file | Verdict | Real production counterpart | Notes |
|---|---|---|---|
| `AGENT.md` | **reference** | — | Routing playbook. Keep here; not actionable code. |
| `SKILL.md` | **reference** | — | Skill description. Keep here. The real local skills live in `.claude/skills/*`. |
| `references/bearing-rules.md` | **reference / donor** | `.claude/skills/bearing-analog-check/references/analog-rules.md`, `type-series-map.md` | Use as extra reading when tuning `AI_SYSTEM` in `ai-kb/src/index.js` or the `bearing-analog-check` skill. Don't overwrite the skill's own rules. |
| `references/system-prompt.md` | **reference / donor** | `AI_SYSTEM` in `ai-kb/src/index.js` + `settings.system_prompt` row in D1 | Live prompt is the D1 override, not a file. Pull ideas from here, but edit the prompt via `POST /api/settings` or the ai-kb admin UI. |
| `references/d1-schema.md` | **reject for production / keep as reference** | `migrations/0001_root_schema.sql`, `ai-kb/migrations/0001…0004` | Schema shape conflicts (see "Schema conflicts" below). Do not apply. |
| `references/wrangler-template.toml` | **reject for production** | `wrangler.toml`, `ai-kb/wrangler.toml` | Bindings, routes and index names are already correct in the live configs. This template targets the root worker and would overwrite `b24-catalog`'s catalog role. |
| `scripts/d1_schema.sql` | **reject** | `migrations/*.sql`, `ai-kb/migrations/*.sql` | Different table shapes (`chat_history` vs `chat_messages`, `documents` vs `files`, `catalog(part_number, d, D, H)` vs real `catalog(base_number, d_inner, d_outer, width_mm)`). Applying this would fork the schema. |
| `scripts/deploy.sh` | **reject** | `.github/workflows/deploy.yml`, `.github/workflows/deploy-ai-kb.yml`, `docs/RUNBOOK.md` | Deploy is already wired via CF Git integration (root) + GitHub Actions (ai-kb). Introducing a shell deploy script would cause drift with the hardened ai-kb workflow (pre-flight token verify + title-retry loop). |
| `scripts/seed_catalog.py` | **reject** | Live catalog-import flow: `POST /api/imports` (root, admin) → `staging_catalog_import` → `catalog_rows` / `catalog_master_view` | The script targets a flat `catalog(part_number, d, D, H, …)` table which is **not** the live shape (`base_number`, `d_inner`, `d_outer`, `width_mm`). Would bypass staging, duplicate rows, and break the import-review skill. |
| `scripts/smoke_test.sh` | **reference** | `docs/RUNBOOK.md` smoke-test snippets | Curl patterns are useful but endpoints (`/health`, `/chat`, `/admin/*`, bearer auth) don't match ai-kb (`/api/health`, `/api/chat`, `X-Admin-Token`). |
| `src/index.js` | **reject** | `src/index.js` (root) + `ai-kb/src/index.js` | Would overwrite the root catalog worker with a chatbot router. The root worker's job is catalog + imports + orders, not chat. |
| `src/chat.js` | **reject** | `handleChat` in `ai-kb/src/index.js:396` | ai-kb's chat already does more: SSE streaming, vision via `llama-3.2-11b-vision-instruct`, attachment text handling, D1 settings overrides, `stream.tee()` history persistence, rate limiting. |
| `src/memory.js` | **reject** | `ensureSession`, `saveMessages`, `handleSessions` in `ai-kb/src/index.js` | Tables differ: package uses `chat_history(session_id, role, content, ts)`, ai-kb uses `chat_sessions` + `chat_messages` (ai-kb migration 0001). |
| `src/rag.js` | **reject** | `searchKnowledge` + `handleIngest` + `handleReindex` in `ai-kb/src/index.js` | ai-kb already owns KB ingest, Vectorize upsert with `bge-m3` 1024-dim, chunked reindex with a per-call CPU budget (`REINDEX_CHUNKS_PER_CALL = 12`). Package's batch-of-100 upsert and unbounded ingest would hit CPU limits. |
| `src/bearings.js` | **reject / partial donor** | `AI_SYSTEM` prompt + `catalog_fts`/`catalog` search in `ai-kb/src/index.js` | `catalog` schema mismatch kills `enrichBearingContext` directly. Type-series logic is already in the prompt. The `EXECUTION_SUFFIXES` list is a usable donor if we ever add server-side normalization, but not needed today — the LLM + FTS handle it. |
| `src/prompt.js` | **reject / donor** | Prompt assembly in `handleChat` (ai-kb) | ai-kb builds `Контекст: / Прикреплённые документы: / Описание изображений: / Вопрос:` blocks which cover the same role as the package's `=== CONTEXT === / === CATALOG HIT ===`. No net gain from switching. |
| `src/admin.js` | **reject** | `handleGetSettings` / `handleSetSettings` / `handleSessions` / `handleAdminFiles*` + root `/api/admin/audit` | Routes differ (`/admin/*` bearer vs `/api/admin/*` + `/api/settings` with `X-Admin-Token`). Auth models differ (`Authorization: Bearer` vs `X-Admin-Token`). Copying would break the admin UI in `ai-kb/public/app.js` and the inline `adminFetch` in `public/index.html`. |
| `src/config.js` | **reject** | `ensureSettingsTable` / `getSetting` / `SETTING_KEYS` in `ai-kb/src/index.js` | Package uses a `config(key,value,updated_at)` table; ai-kb uses `settings(key,value,updated_at)`. Same pattern, different table name. Switching would require a data migration for no functional gain. |

## Schema conflicts — why `scripts/d1_schema.sql` cannot be applied

| Package table | Live equivalent | Conflict |
|---|---|---|
| `chat_history(id, session_id, role, content, ts)` | `chat_sessions(id, title, …)` + `chat_messages(session_id, role, content, sources, created_at)` — `ai-kb/migrations/0001_initial.sql` | Different split; dual tables would duplicate history writes. |
| `documents(doc_id TEXT PK, r2_key, chunks, indexed, …)` | `files(id INTEGER PK, r2_key, sha256, …)` + `file_extracts` + `kb_chunks` — `ai-kb/migrations/0002_files_rules_catalog.sql` | Different PK type and richer extract/chunk model in live schema. |
| `catalog(part_number TEXT, d, D, H, execution, analog_gost, analog_iso, …)` | `catalog(base_number, d_inner, d_outer, width_mm, brand, skf_analog, fag_analog, …)` — used by `searchCatalog` in `ai-kb/src/index.js:244-276` | Completely different column names. All package SQL using `d/D/H/part_number/analog_gost` would 500 on the live DB. |
| `config(key,value,updated_at)` | `settings(key,value,updated_at)` — `ai-kb/src/index.js:ensureSettingsTable` | Parallel tables for the same concept. |
| `leads` | Not in live schema | Would be additive, but production already routes leads through `orders` (root) + Bitrix24 webhook, so a `leads` table is redundant. |

## Route conflicts

| Package route | Live equivalent | Conflict |
|---|---|---|
| `POST /chat` (root) | `POST /api/chat` (ai-kb) | Would duplicate chat; root worker does not own chat, ai-kb does. |
| `POST /upload` + `POST /ingest` (root, admin-bearer) | `POST /api/admin/files/upload` (ai-kb) + `POST /api/ingest` (ai-kb, `X-Admin-Token`) | Auth header and path differ. Copying breaks the admin UI. |
| `/admin/config`, `/admin/config/:key` | `GET/POST /api/settings` | Same purpose, incompatible shape. |
| `/admin/stats` | `GET /api/stats` (ai-kb) + `GET /api/admin/audit` (root) | Already covered. |
| `/admin/documents`, `/admin/session/:id`, `/admin/cleanup` | `GET /api/admin/files`, `DELETE /api/sessions/:id`, no cleanup route (ai-kb relies on TTL/manual cleanup via D1 console) | Copying would shadow the live admin surface. |

## When to re-mine this package

Good reasons to reopen the package later:
- Tightening the bearing prompt further — `references/bearing-rules.md` and `references/system-prompt.md` have well-structured rule tables. Feed into `AI_SYSTEM` or into `settings.system_prompt` via the admin UI.
- Adding explicit server-side bearing normalization (suffix stripping, type classification) if LLM+FTS ever stops being enough — `src/bearings.js` `EXECUTION_SUFFIXES` and `normalize()` are reasonable starting points, but target them at `ai-kb/src/index.js` (single-file worker), not as new modules.
- Adding a `CATALOG_INDEX` Vectorize binding if semantic catalog search is ever needed in addition to the current FTS5. Package's `retrieveContext` demonstrates the two-index pattern. Would require a new migration and a new Vectorize index — treat as a separate PR and run the `d1-migration-safety` + `cloudflare-worker-review` skills first.

## Not acceptable without a deep rewrite + schema migration

- Replacing root `src/index.js` with the package's chat router.
- Replacing `ai-kb/src/index.js` with the package's `src/*` modules.
- Applying `scripts/d1_schema.sql` against `baza` (would fork schema or fail on duplicate-but-differently-shaped tables).
- Running `scripts/seed_catalog.py` against the live D1 (wrong column names; bypasses the staging/review flow owned by the `catalog-import-review` skill).
- Switching auth from `X-Admin-Token` to `Authorization: Bearer` on ai-kb without updating `ai-kb/public/app.js`.
