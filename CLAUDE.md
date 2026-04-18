# CLAUDE.md

Guidance for AI assistants working in this repository.

## Project overview

B2B bearing catalog for **ООО «Эверест» / ТД «Эверест»** (Vologda). Two independent Cloudflare Workers in one repo, sharing a D1 database and an R2 bucket:

- **`b24-catalog`** (repo root) — serves the catalog HTML, hosts the import/order REST API, runs a daily D1→R2 backup cron.
- **`ai-kb`** (`ai-kb/` subdir) — standalone AI consultation chat with per-session memory.

All user-facing text (UI, API errors, AI system prompts) is in **Russian**. Keep new strings in Russian.

## Architecture

```
b24-catalog/
├── src/index.js              # Main Worker (369 lines, plain JS)
├── public/
│   ├── index.html            # Catalog SPA (minified bundle)
│   └── _headers              # CORS + cache-control
├── data/
│   ├── ewerest_bearing_catalog_filled_all.xlsx  # source of truth
│   ├── gen_catalog.py                            # XLSX → catalog.gz
│   └── catalog.gz                                # compact compressed catalog
├── wrangler.toml             # Main Worker config
├── ai-kb/
│   ├── src/index.js          # AI Worker (hand-minified, 63 lines)
│   ├── public/index.html     # Chat UI
│   └── wrangler.toml         # AI Worker config
└── .github/workflows/
    ├── deploy.yml            # Main Worker deploy (ignores ai-kb/**)
    └── deploy-ai-kb.yml      # AI Worker deploy (paths: ai-kb/**)
```

No `package.json`, no bundler, no tests, no linter. Edit `.js` files directly.

## Entry points

- `src/index.js` — single `export default { fetch, scheduled }`. Path-based router inside `fetch`. Key functions: `jsonOk` (L29), `jsonErr` (L35), `searchCatalog` (L45), `askAi` (L97), `backupD1toR2` (L145), router (L193). Admin token is hardcoded at L324.
- `ai-kb/src/index.js` — same pattern, but hand-minified (single-line functions, no whitespace). Preserve that style when editing, or ask the user first.

## API endpoints

Main Worker (`b24-catalog`):

| Path | Method | Purpose |
|---|---|---|
| `/`, `/app` | GET | Catalog HTML |
| `/catalog.gz` | GET | Gzipped catalog from R2 |
| `/api/ping` | GET | Healthcheck |
| `/api/ask` | GET/POST | AI consultation (Workers AI + D1 search) |
| `/api/imports` | GET | Active imports (soft-deleted excluded) |
| `/api/imports` | POST | Insert rows batch + session record |
| `/api/imports/:session_id` | DELETE | Soft-delete session (`deleted = 1`) |
| `/api/sessions` | GET | Import session list |
| `/api/orders` | GET/POST | Customer orders |
| `/api/backup` | POST | Manual D1→R2 backup |
| `/api/admin/upload-catalog` | POST | Upload `catalog.gz` to R2; requires `x-upload-token` header |

AI Worker (`ai-kb`):

| Path | Method | Purpose |
|---|---|---|
| `/api/ping` | GET | Healthcheck |
| `/api/ask` | GET/POST | Ask with optional `session_id` for memory |
| `/api/history/{session_id}` | GET | Conversation history |
| `/api/history/{session_id}` | DELETE | Clear session memory |

## Cloudflare bindings

Both workers use the same bindings in their `wrangler.toml`:

- `DB` — D1 database `baza`, id `11a157a7-c3e0-4b6b-aa24-3026992db298`
- `CATALOG` — R2 bucket `vedro` (holds `catalog.gz` and `backups/*.json`)
- `AI` — Workers AI (model `@cf/meta/llama-3.1-8b-instruct`)
- `ASSETS` — static files from `public/`
- `compatibility_date = '2026-04-17'` — keep both `wrangler.toml` files in sync

AI requests go through a gateway with 1h cache TTL (`catalog-ai-gateway` for main, `catalog` for ai-kb). Prompt changes only take effect for new cache keys or after TTL expiry.

## D1 schema (inferred from queries; no migrations in repo)

- **`catalog`** — read-only, pre-seeded: `brand, base_number, gost_equiv, d_inner, d_outer, width_mm`.
- **`imported_rows`** — user imports. Columns referenced: `id, source, uploaded_by, session_id, data (JSON text), base_number, brand, price_rub, quantity, diam_inner_mm, diam_outer_mm, width_mm, deleted, uploaded_at`.
- **`import_sessions`** — `id, uploaded_by, filename, format, rows_count, status, uploaded_at`.
- **`orders`** — `company_name, inn, contact_name, phone, email, comment, total_rub, items_json, status, created_at`.
- **`chat_memory`** (ai-kb) — `session_id, role, content, sources, created_at`.

## Conventions and gotchas

- **Soft delete only.** Mark `deleted = 1`; never `DELETE FROM imported_rows`.
- **Response wrappers.** Use `jsonOk()` / `jsonErr()` from `src/index.js:29-39`. They set CORS + JSON content-type.
- **CORS is open (`*`).** Don't tighten without an explicit request.
- **Batch writes.** Bulk inserts in `/api/imports` use `env.DB.batch()` — preserve for performance.
- **Embedded JSON.** `imported_rows.data` and `orders.items_json` hold stringified JSON. Always `JSON.parse` inside try/catch; swallow failures silently (pattern already used).
- **Parameterized SQL.** Every query uses `.bind()`. No string concatenation into SQL.
- **Minified AI Worker.** `ai-kb/src/index.js` is intentionally hand-minified. Don't auto-format it.
- **Admin token.** Hardcoded at `src/index.js:324`. Don't change or print it without explicit instruction.
- **Two deploy workflows are mutually exclusive.** `deploy.yml` ignores `ai-kb/**`; `deploy-ai-kb.yml` runs only for `ai-kb/**`. A commit touching both still triggers only the root deploy — split commits when both need to ship.
- **AI answers extracted from two shapes.** `resp.response` or `resp.result?.response` (see `extractAiAnswer`, `src/index.js:91`).
- **Input trimming.** Search queries are truncated to 100 chars; ai-kb also strips `'"` ` ; \` before querying.

## Development workflow

- **Local run:** `npx wrangler dev` from the repo root for `b24-catalog`, or from `ai-kb/` for the AI worker. Requires `wrangler` CLI and Cloudflare auth.
- **Deploy:** auto on push to `main`.
  - Root paths → `.github/workflows/deploy.yml` (uploads `data/catalog.gz` to R2, then runs `wrangler deploy`).
  - `ai-kb/**` paths → `.github/workflows/deploy-ai-kb.yml` (`wrangler deploy` in `ai-kb/`).
  - Secret required: `CF_API_TOKEN`. Account id `84cbacc4816c29c294101ec57a0bea5d` is hardcoded.
- **Manual deploy:** `npx wrangler deploy` (main) or `cd ai-kb && npx wrangler deploy`.
- **Tests / lint:** none. Verify changes by reading them and by deploying to a staging environment if the user provides one.

## Catalog data pipeline

1. Edit `data/ewerest_bearing_catalog_filled_all.xlsx` (source of truth; 42-column schema documented in `data/gen_catalog.py` docstring).
2. Regenerate: `python data/gen_catalog.py` → writes `data/catalog.gz` (gzip of `{rows, dicts, meta}` JSON; dict-index compression for categorical columns).
3. Commit the updated `catalog.gz`. `deploy.yml` uploads it to `r2://vedro/catalog.gz` before deploying the Worker.
4. Alternative for hot-swaps: `POST /api/admin/upload-catalog` with the token header; see `src/index.js:322`.

## Cron: daily D1 backup

`wrangler.toml` → `[triggers] crons = ['0 3 * * *']` (03:00 UTC). Handler: `scheduled` in `src/index.js:189` → `backupD1toR2` at `src/index.js:145`. Dumps `imported_rows`, `import_sessions`, `orders` into `backups/d1-backup-<ts>.json` and mirrors to `backups/latest.json`. `POST /api/backup` triggers it manually. The ai-kb `wrangler.toml` also declares the cron but the Worker has no `scheduled` handler — backup is performed by the main Worker only.

## Git workflow

Default branch is `main`. Feature branches follow `claude/<topic>-<short-id>`. Deploy happens on push to `main`, so merge via PR rather than pushing directly. Keep root-only and `ai-kb/`-only changes in separate commits if both need to deploy.
