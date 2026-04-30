# Golden signals — what to watch on this stack

The four classic SRE signals (Latency, Traffic, Errors, Saturation) mapped to
what we can actually observe via Cloudflare's free tier (no Datadog, no
Prometheus, just `wrangler tail` + D1 query_log + `[observability]`).

## Latency

Where it shows up:
- `query_log.latency_ms` — wall-clock from `t0 = Date.now()` to end of stream persist for `/api/chat`. Captures the full chain.
- Cloudflare Workers Observability (auto-enabled via `[observability]` in `wrangler.toml`) — per-request CPU and wall time per route.
- `X-Sources-*` headers — count per leg, not timing, but help correlate "long latency" with "Brave returned 5 hits".

What's normal:
- `/api/chat` first token: 1–2s warm, 3–5s cold (KV warm-up).
- `/api/chat` full response: 5–10s warm, up to 15s with vision.
- `/api/imports`, `/api/orders`: <100ms.
- `/api/backup` cron: 30–60s for the full D1 → R2 snapshot.

What's broken:
- `/api/chat` first token >5s — usually Brave hanging, vision spinning, or `env.AI.run` cold-starting. Check `X-Sources-Web` first.
- `/api/chat` full response >15s without vision — the LLM is generating long output OR there's a runaway loop in `persist`.

## Traffic

Where:
- Cloudflare Dashboard → Workers → b24-catalog/ai-kb → Metrics. Requests per second per route.
- `query_log` row count per minute for `/api/chat`.
- `rate_limit` table row count growing fast → either real load or a script.

What's normal:
- ai-kb chat: 5–30 req/min during business hours (Russia +3).
- b24-catalog imports: ~1 req/min from authenticated agents.
- Backup cron: 1 success/day at 03:00 UTC.

What's broken:
- 0 traffic on `/api/chat` for >10 min during business hours — UI broken, deploy regressed, or DNS issue.
- Sustained >100 req/min on `/api/chat` from one IP — `checkRate` should be catching it; if it isn't, investigate the `bucket` keying.

## Errors

Where:
- `query_log.error` (non-null) — chat-side errors that didn't crash the stream.
- `wrangler tail` filtered to status >=500.
- Cloudflare Dashboard error rate per route.
- `admin_audit_log` rows with action that recorded a failure.
- GitHub Actions: failed runs of `deploy-ai-kb.yml`.

What's normal:
- ~1–2% chat error rate — Brave 429s, Vectorize transient, model timeouts. Fail-open swallows them.
- Zero 5xx on `/api/health`, `/api/stats`, `/api/imports`.

What's broken:
- Chat error rate >5% sustained for 15 min — page. Most likely Workers AI region issue or D1 quota.
- Any 5xx on `/api/health` — synthetic monitor will trip first; investigate before user reports come in.

## Saturation

Where:
- D1: SQLite has no traditional saturation; what to watch is row counts on hot tables. `chat_messages` and `query_log` grow forever — schedule periodic prune.
- Vectorize: `env.VECTORIZE.describe()` returns `vectorCount`. If it stops growing during active use, ingest is broken.
- R2: `vedro` bucket size. Backup cron writes daily; cleanup not automated yet.
- Workers AI: per-day request quota on Workers AI plan. Approach to limit will surface as `env.AI.run` throwing rate-limit errors.
- Brave: 2000 queries/month free tier. Monitor at https://api.search.brave.com/app/dashboard.

Pruning triggers (none automated yet — runbook TODO):
- `chat_messages` >1M rows → archive sessions older than 6 months.
- `query_log` >5M rows → keep last 30 days, write older to R2 as Parquet/CSV.
- `knowledge_base` `category='web'` >10k rows → admin review + bulk delete of low-value snippets.
- R2 `vedro` snapshots >30 → delete oldest.
