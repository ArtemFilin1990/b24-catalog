---
name: cloudflare-worker-review
description: Review Cloudflare Worker changes in b24-catalog / ai-kb — routes, bindings, secrets, admin/upload auth, audit coverage, deploy workflow hardening, and isolation between the root and ai-kb workers.
---

Use this skill when the PR touches any of:

- `src/index.js`, `ai-kb/src/*.js`, `ai-kb/public/app.js`
- `wrangler.toml`, `ai-kb/wrangler.toml`
- `.github/workflows/deploy.yml`, `.github/workflows/deploy-ai-kb.yml`
- any new `/api/*` route, any secret, any binding

## Pre-flight

1. Read the relevant source: `src/index.js` for root worker, `ai-kb/src/index.js` (+`ai-kb/src/files.js`, `ai-kb/src/ratelimit.js`) for ai-kb.
2. Confirm the worker's bindings in its `wrangler.toml` match what the code actually references.
3. Keep `CLAUDE.md` §"Admin auth + audit" and §"Deployment: DO NOT rely on Cloudflare's native Git integration for ai-kb" open; they encode hard-won operational rules.

## Hard rules (do not merge if violated)

- **No hardcoded secrets / tokens in source.** The upload endpoint used to have one; if it ever shows up in a diff again, rotate and block the PR.
- **Root `requireAdmin` uses `safeEqual`** (`src/index.js:51`) — constant-time compare. Do not replace with `===`.
- **Root accepts `X-Admin-Token` and `Authorization: Bearer …`.** ai-kb accepts `X-Admin-Token` only. Do not mirror the root helper into ai-kb (separate workers, separate secret stores).
- **`requireUpload` stays narrow.** Only `POST /api/admin/upload-catalog` may use it. Any other route must use `requireAdmin`.
- **Privileged actions must audit.** Every new code path that passes `requireAdmin` should be followed by `ctx.waitUntil(audit(env, request, <action>, <resource>, <meta>))` so the response returns before the log write.
- **Do not add runtime `CREATE TABLE`** in the worker. Put schema in `migrations/*.sql`. `ensureSettingsTable` in `ai-kb/src/index.js` is grandfathered — do not propagate the pattern.
- **Frontend admin token stays in `sessionStorage`** (root: `ev_admin_token`; ai-kb: `ai-kb-admin`). Never `localStorage`. Never stringified into HTML.

## Bindings & config invariants

Root `wrangler.toml`:

- `name = "b24-catalog"`, `main = "src/index.js"`, static at `./public` via `[assets]`.
- D1 `binding = "DB"`, `database_name = "baza"`, `database_id = "11a157a7-c3e0-4b6b-aa24-3026992db298"`.
- R2 `binding = "CATALOG"`, `bucket_name = "vedro"`.
- Observability: `[observability]`, `[observability.logs]`, `[observability.traces]` each with `head_sampling_rate`, two-space indented.
- Cron `0 3 * * *` for `POST /api/backup` (D1 → R2).

`ai-kb/wrangler.toml`:

- `name = "ai-kb"`, `main = "src/index.js"`, static at `./public`.
- Same D1 id, same R2 bucket (binding `CATALOG`), plus `[[vectorize]] binding = "VECTORIZE", index_name = "ai-kb-index"`, and `[ai] binding = "AI"`.
- Same observability subtable shape as root.

Do not change binding **names** (`DB`, `CATALOG`, `VECTORIZE`, `AI`, `ASSETS`) — every runtime reference in the two `src/index.js` files depends on them.

## Deploy flow — critical

| Worker | Deploy path |
|---|---|
| `b24-catalog` | Cloudflare native Git integration on push to `main` (path-scoped via `deploy.yml` `paths-ignore: ai-kb/**`). |
| `ai-kb` | **Only** via `.github/workflows/deploy-ai-kb.yml`. Native CF Git build is disabled at the account level. |

`deploy-ai-kb.yml` invariants — do not drop any:

- Cron `*/15 * * * *` self-heal trigger.
- Pre-flight: `GET /accounts/{id}/tokens/verify` (**not** `/user/tokens/verify`).
- `npm i -g wrangler@4.83.0` (exact pin; newer versions have regressed before).
- Verify-title retry loop — up to 6 attempts, 30/60/90/120/150/180s backoff.
- Smoke checks: `<title>Бот Эверест</title>` in the HTML and `/api/health` returning the `llama-3.3-70b` model tag.

If you see native CF build re-enabled for the `ai-kb` service, the root worker's bundle will overwrite ai-kb on every push. Re-disable with `DELETE /accounts/.../workers/services/ai-kb/environments/production/build-trigger` (caveat: on some versions this deletes the whole worker — see `CLAUDE.md`).

## Rate limiting (root)

`migrations/0002_rate_limit.sql` backs `rate_limit_tokens`. The root worker's `/api/orders` and `/api/ask` use a sliding-window limiter. ai-kb has its own limiter in `ai-kb/src/ratelimit.js` (30 req/min per IP; admins bypass). Do not couple the two limiters.

## Output contract

Use the shared shape in `.claude/skills/README.md`:

```
Decision: APPROVE | APPROVE WITH FIXES | REQUEST CHANGES

Why:
- …

Blocking fixes:
- <path:line — concrete change>

Non-blocking improvements:
- …

Merge recommendation: …
```

## References

- `references/worker-review-checklist.md` — line-by-line repo-specific checklist.
- `references/deploy-hardening.md` — deploy-time invariants and rollback steps.

## Scripts

- `scripts/review_worker.sh [target]` — static scan of `src/`, `ai-kb/src/`, wrangler configs, deploy workflow for the hard-rule violations above.
