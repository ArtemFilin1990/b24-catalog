# cloudflare-worker-review — repo-specific checklist

## Auth & audit (root `src/index.js`)

- [ ] `safeEqual` (`src/index.js:51`) is not replaced with `===` or `==` on any token compare.
- [ ] `requireAdmin` still accepts both `X-Admin-Token` and `Authorization: Bearer …`.
- [ ] `requireUpload` (`src/index.js:75`) is called **only** by `POST /api/admin/upload-catalog`. Every other protected route uses `requireAdmin`.
- [ ] Public endpoints remain public and well-validated: `GET /api/imports`, `POST /api/orders`, `POST /api/ask`.
- [ ] Admin-gated endpoints audit: `POST /api/backup`, `GET /api/orders`, `POST /api/imports`, `DELETE /api/imports/:id`, `GET /api/sessions`, `GET /api/admin/audit`, `POST /api/admin/upload-catalog`.
- [ ] Every new `requireAdmin` branch is followed by `ctx.waitUntil(audit(env, request, <action>, <resource>, <meta>))`.
- [ ] No runtime `CREATE TABLE` added to `src/*.js`. `admin_audit_log` lives in `migrations/0001_root_schema.sql`.

## Auth & audit (ai-kb `ai-kb/src/index.js`)

- [ ] `requireAdmin(request, env)` stays at `X-Admin-Token` + `===`, no Bearer support.
- [ ] Admin endpoints remain: `POST /api/settings`, `POST /api/ingest`, `POST /api/reindex`, `POST /api/admin/files/upload`, `GET /api/admin/files`, `DELETE /api/admin/files/:id`, `GET /api/admin/storage/stats`, `DELETE /api/sessions/:id`.
- [ ] Public endpoints remain public: `POST /api/chat`, `GET /api/search`, `GET /api/stats`, `GET /api/health`, `GET /api/settings`, `GET /api/sessions`, `GET /api/sessions/:id/messages`.
- [ ] Rate limiter (`ai-kb/src/ratelimit.js`) is invoked before expensive routes (`/api/chat`, `/api/search`). Admins bypass.

## Bindings vs. code

- [ ] Root worker references only `env.DB`, `env.CATALOG` (R2 bucket `vedro`) + cron bindings.
- [ ] ai-kb references `env.DB`, `env.CATALOG` (R2 bucket `vedro`), `env.VECTORIZE`, `env.AI`, `env.ASSETS`.
- [ ] No new binding is added to code without a matching block in the worker's `wrangler.toml`.
- [ ] Binding **names** are unchanged. (`DB`, `CATALOG`, `VECTORIZE`, `AI`, `ASSETS`.)

## Config drift

- [ ] `wrangler.toml` and `ai-kb/wrangler.toml` observability subtables stay two-space indented with `head_sampling_rate` on each.
- [ ] D1 id, R2 bucket name, Vectorize index name, dims (1024), metric (cosine) are unchanged.
- [ ] Root cron stays `0 3 * * *`.
- [ ] ai-kb deploy cron stays `*/15 * * * *` in `.github/workflows/deploy-ai-kb.yml`.

## Deploy workflow

- [ ] `deploy-ai-kb.yml` pins `wrangler@4.83.0` in the `npm i -g` step.
- [ ] Pre-flight hits `/accounts/{id}/tokens/verify`, not `/user/tokens/verify`.
- [ ] Verify-title retry loop is present (up to 6 attempts, 30/60/90/120/150/180s backoff).
- [ ] Title check asserts `<title>Бот Эверест</title>`.
- [ ] `/api/health` smoke asserts the `llama-3.3-70b` model tag.
- [ ] `deploy.yml` still uses `paths-ignore: ai-kb/**`; `deploy-ai-kb.yml` still uses `paths: ai-kb/**`.

## Frontend hygiene (ai-kb `ai-kb/public/app.js`)

- [ ] Admin token kept in `sessionStorage['ai-kb-admin']`; `adminFetch` retries once on 401.
- [ ] Attachments sent as separate `attachment_text` / `images[]` fields, never spliced into `messages[].content`.
- [ ] Client-side extraction (`extractPdf`, `extractDocx`, `extractXlsx`) still runs `looksBinary()` to reject mojibake uploads.

## Secrets

- [ ] `ADMIN_TOKEN` stored as a Wrangler secret on both workers (separate values per worker).
- [ ] `ADMIN_UPLOAD_TOKEN` stored as a Wrangler secret on the root worker only.
- [ ] No secret committed to source or to `.github/workflows/*.yml` outside `${{ secrets.X }}` references.
- [ ] After a secret rotation, the deployed worker version has been updated (see the `versions secret put` flow in `CLAUDE.md`).
