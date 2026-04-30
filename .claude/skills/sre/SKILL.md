---
name: sre
description: Site reliability for the two-worker stack — SLOs, error budgets, observability, deploy safety, and toil reduction sized for Cloudflare Workers + D1 + Workers AI, not a Kubernetes monolith.
---

Use this skill when the change touches reliability surface area:

- `.github/workflows/deploy*.yml` (deploy retry / verify loop / cron self-heal)
- `docs/RUNBOOK.md`
- error handling / `try/catch` around `env.AI.run`, `env.VECTORIZE.*`, `env.DB.*`, `fetch()` to third parties
- new `ctx.waitUntil(...)` callsites (fire-and-forget persistence)
- new `X-Sources-*` / observability headers, `query_log`, `admin_audit_log`
- rate-limit thresholds (`ai-kb/src/ratelimit.js`, `src/ratelimit.js`)
- backup cron (`POST /api/backup` triggered `0 3 * * *`)
- chat streaming path (the latency-critical hot path)

Pairs with `cloudflare-worker-review` (deploy hygiene) and `security-engineer` (which threats matter for SLO).

## SLO targets — proposed defaults

The repo doesn't have explicit SLOs yet. Use these as the baseline for review decisions; codify in `docs/RUNBOOK.md` whenever you change them.

| Service | SLI | Target | Window |
|---|---|---|---|
| `b24-catalog /api/imports` | `count(status<500) / count(total)` | 99.9% | 30d |
| `b24-catalog /api/orders POST` | `count(status<500) / count(total)` | 99.95% | 30d |
| `ai-kb /api/health` | `200 OK with model tag` | 99.95% | 30d |
| `ai-kb /api/chat` first-token | `p95 < 3s` (warm RAG) | 95% | 7d |
| `ai-kb /api/chat` full response | `p95 < 12s` (with vision) | 95% | 7d |
| Cron backup `POST /api/backup` | success per night | 100% over rolling 7d | 7d |

Each "nine" costs ~10x more — don't promise 99.99% on a free-tier dependency chain.

## Hard rules

- **Never block the user-facing stream.** All persistence, logging, audit, and auto-ingest goes through `ctx.waitUntil(...)`. If a new code path between `stream.tee()` and the final `return new Response(streamA, …)` adds an `await`, it's a finding.
- **External fetch has a budget.** Any `fetch()` to a third party (Brave today; tomorrow maybe a manufacturer API) needs `AbortSignal.timeout(...)` with a budget that fits inside the chat hot path. Brave is 2.5s — see `ai-kb/src/web_search.js` for the pattern.
- **Fail open, log loud.** When a non-essential leg fails (web search, vision, vectorize) the chat still responds; the failure shows up in `query_log.error` or `X-Sources-*`. Don't add 5xx-on-failure for non-essential legs.
- **Idempotent everything.** Backup, reindex, ingest, self-heal — all must survive being run twice. The `*/15 * * * *` self-heal cron in `deploy-ai-kb.yml` only works because deploy is idempotent.
- **No new `console.log` in the hot path.** Workers logs cost CPU and are rate-limited; use `[observability]` in `wrangler.toml` and structured fields the platform already captures (status code, route, latency).
- **Toil → automation, not docs.** If the runbook tells the operator to run the same wrangler incantation more than once a quarter, fold it into the deploy workflow or a `npm run` script.

## Hot path latency budget (`/api/chat`)

The current chain, with realistic per-leg budgets. Total budget = first-token p95 < 3s.

```
parse body                    ~5ms
resolveUser / requireAdmin    ~10ms (D1 read)
checkRate                     ~10ms (D1 UPSERT RETURNING)
load settings                 ~15ms (D1 read)
extractDimensions             ~1ms
extractBearingTypeHint        ~1ms
Promise.all:
  searchCatalog               ~50–200ms (D1 FTS5 / LIKE)
  searchKnowledge             ~150–400ms (embed + vectorize.query)
  findAnalogsByDimensions     ~30–80ms (D1)
  webSearch (Brave)           ≤ 2500ms (timeout-bounded)
describeImage (per image)     ~3000–5000ms — gates on first token
ensureSession                 ~10ms (D1 read + maybe insert)
env.AI.run (CHAT_MODEL)       first token ~400–1500ms
```

Vision is the biggest user-visible spike. Plan: keep `MAX_IMAGES = 3`; if vision becomes routine, move it to a separate streamed-attachment endpoint so it doesn't gate first token. Discuss before changing.

## Observability invariants

- **`X-Sources-*` headers** must reflect actual leg outputs: `Catalog`, `Kb`, `Geo`, `Web`, `Images-Described`. New legs add headers. Don't drop them — UI hooks rely on the count.
- **`query_log`** schema lives in `ai-kb/migrations/0001_initial.sql`: `(session_id, question, answer_len, sources_kb, sources_cat, model, latency_ms, error)`. Two source columns only — geo rolls into `cat`, web rolls into `kb` (documented in `handleChat`).
- **`admin_audit_log`** is root-only. Privileged routes that bypass `requireAdmin` checks (e.g. cron) don't need to audit but must log the trigger source.

## Deploy safety (cross-reference `cloudflare-worker-review` for the rules; this skill cares about *what to do when a deploy fails*)

- `deploy-ai-kb.yml` retry loop: 6 attempts, 30/60/90/120/150/180s backoff, then page. If you tighten this, also lower the per-attempt timeout — or you'll just stack longer.
- `*/15 * * * *` cron is the safety net. If you change the production worker out-of-band (dashboard edit, `wrangler versions deploy`), this cron will overwrite within 15 minutes. Either disable the cron or push your change through the workflow.
- **Smoke check**: `<title>Бот Эверест</title>` + `/api/health` returning the right model tag. If the smoke is green but the worker is broken, your smoke check is wrong — extend it before fixing the broken code.

## Incident response checklist

Before paging anyone, in order:

1. Hit `/api/health` on the affected worker. If the model tag is wrong, deploy regressed — re-run `deploy-ai-kb.yml` (or wait ≤15min for cron).
2. Tail logs: `npx wrangler tail b24-catalog` or `cd ai-kb && npx wrangler tail ai-kb`. Filter by status >=500 first.
3. Check `query_log` for the affected window: `SELECT model, error, COUNT(*) FROM query_log WHERE created_at > datetime('now','-15 minutes') GROUP BY model, error;`
4. If D1 is the suspect: `SELECT type, name FROM sqlite_master ORDER BY name;` — confirms migrations are applied, no objects went missing.
5. If R2 backup hasn't run today (`SELECT * FROM admin_audit_log WHERE action = 'backup' ORDER BY id DESC LIMIT 1;`), trigger it manually before more changes — you want a clean snapshot before debugging.

Post-incident: every page-worthy event gets a one-line entry in `docs/RUNBOOK.md` under "Past incidents" with date, symptom, root cause, fix, and the *systemic* change that prevents recurrence (not just "I fixed the bug").

## Output contract

```
Decision: APPROVE | APPROVE WITH FIXES | REQUEST CHANGES

Why:
- <reliability driver, with budget impact>

Blocking fixes:
- <file:line — concrete change; reference the SLO or invariant it violates>

Non-blocking improvements:
- <file:line — concrete change>

Merge recommendation:
- <squash | rebase | hold for runbook update>
```

When the change consumes meaningful error budget (new external dep, raised timeout, new `await` in hot path), call it out explicitly: "this raises p95 first-token from ~1.5s to ~3s — within budget but uses 60% of the headroom."
