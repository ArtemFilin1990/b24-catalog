# Threat model — b24-catalog + ai-kb

STRIDE applied to what actually exists in this repo. Refresh whenever a new
trust boundary appears.

## System overview

Two Cloudflare Workers, one shared D1 + R2:

- **`b24-catalog`** (`src/index.js`, `public/`): bearings catalog UI,
  `/api/imports`, `/api/orders`, `/api/ask` (Llama 3.1 8B), nightly D1→R2
  backup via cron. Native CF Git integration.
- **`ai-kb`** (`ai-kb/src/index.js`, `ai-kb/public/`): chat UI with RAG
  (D1 FTS + Vectorize), web search (Brave), auth (PBKDF2 + Bearer),
  vision (llama-3.2-11b-vision), auto-learn. GHA-only deploy.

Shared D1 `baza` (id `11a157a7-c3e0-4b6b-aa24-3026992db298`), R2 `vedro`
(binding `CATALOG`), Workers AI, Vectorize `ai-kb-index` (1024-dim cosine).

## Trust boundaries

| Boundary | From | To | Controls |
|---|---|---|---|
| Internet → ai-kb | Browser | ai-kb worker | TLS, `requireAdmin` (X-Admin-Token), `resolveUser` (Bearer), `checkRate` |
| ai-kb → D1 | Worker | `baza` | parameterized queries via `.bind()`, no string concat |
| ai-kb → Vectorize | Worker | `ai-kb-index` | server-side embed call, IDs are `kb-<rowid>-<chunk>` |
| ai-kb → Brave | Worker | api.search.brave.com | `X-Subscription-Token` from `env.BRAVE_API_KEY`, 2.5s timeout |
| ai-kb → Workers AI | Worker | `env.AI` | bound at deploy, no key exchange at runtime |
| User chat → KB | LLM-cited web hit | `knowledge_base` | gated by `canAutolearn = isAdmin || allowlist`; sanitised at write |
| Admin token | Operator | privileged routes | `safeEqual` constant-time |
| User session | Browser | `/api/chat`, `/api/sessions/*` | Bearer `^[A-Fa-f0-9]{32,128}$`, 30-day expiry |

## STRIDE — concrete instances

### Spoofing

- **Bearer token theft** (Browser → ai-kb): mitigated by 30-day expiry + revoke on logout. Risk: tokens in localStorage are accessible to XSS — keep CSP tight on the UI (currently weak).
- **Username squatting** (admin promotes via allowlist): `autolearn_allowed_users` is case-sensitive comma list. If an attacker can register the exact same username an admin will later type, they get auto-ingest. Mitigation: usernames are unique in `users` table, so attacker would have to register first; admin must verify before adding.

### Tampering

- **Direct DB writes** are gated by `requireAdmin` for `/api/ingest`, `/api/admin/files/*`, `/api/settings POST`. Self-heal `ensureAuthTables` and `ensureSettingsTable` are runtime CREATE TABLE IF NOT EXISTS — idempotent, no escalation surface.
- **KB poisoning via auto-learn**: see §"KB poisoning" below — primary new threat from PR #55.
- **Prompt override**: `settings.system_prompt` overrides `AI_SYSTEM`. Only admin can write. Confirm new endpoints don't expose this column.

### Repudiation

- Root worker has `admin_audit_log` (migration `0001_root_schema.sql`). ai-kb intentionally has none — chat history in `chat_messages` is the audit. Don't add a separate ai-kb audit without proposing the schema first.
- `query_log` records every chat (sources counts, latency, error). Useful for forensics; keep it appended-only.

### Information disclosure

- **Verbose errors**: handlers return `{ ok: false, error: e.message }`. Workers AI sometimes returns errors with internal model paths. Trim to the leading clause before returning.
- **`/api/health`**: returns the model tag publicly — fine, but don't extend it to expose vector dim, KB row counts, or env presence.
- **`X-Sources-*` headers** are intentional observability; they leak nothing PII.

### Denial of service

- Rate limit (`ai-kb/src/ratelimit.js`): chat 30/min/IP. Login 10/min, register 5/5min. Brave `webSearch` has 2.5s `AbortSignal.timeout`.
- Vision (`describeImage`) is the most expensive per-turn call (~3-5s p99). It's gated by `MAX_IMAGES = 3` per request, no per-IP cap. Watch for abuse.
- Vectorize upsert is fire-and-forget inside `ctx.waitUntil` — won't add user-visible latency.

### Elevation of privilege

- **`isAdmin` short-circuits `resolveUser`** in handlers (`isAdmin ? null : await resolveUser(...)`). If a future change reorders this, an admin-flagged request without a Bearer would still work (correct), but ensure the X-Admin-Token check happens with `safeEqual`, not `===`.
- **`/api/auth/me` / `logout`**: don't add ability to elevate via these. Logout is unauth (revokes any token by value); registering with a username already used is rejected at INSERT-time by the UNIQUE constraint.
- **Admin token reuse**: same `ADMIN_TOKEN` secret per worker, set via `wrangler secret put`. Rotation runbook in `docs/RUNBOOK.md` — follow it on every leak.

## KB poisoning (the new attack surface from web-search + auto-learn)

Path: attacker SEO-games a page → Brave returns it for a crafted question → LLM cites `[1]` → `autoIngestWebHits` persists to `knowledge_base` + Vectorize → influences every future chat.

Mitigations in place:
1. `canAutolearn = isAdmin || allowlist` — only trusted users can grow the KB.
2. `sanitizeForUntrustedBlock()` neutralises `UNTRUSTED_WEB_BEGIN/END` markers and `===+` runs in `title/url/snippet` before persist.
3. `category='web'` is preserved on the row + vector metadata.
4. `searchKnowledge` returns `category`; `buildContext` re-wraps category=web rows in UNTRUSTED delimiters at retrieval time so old rows are also safe.
5. Dedup by URL with `getByIds()` repair-on-skip if the vector is missing.

Residual risk: an allowlisted user who is socially engineered or whose account is compromised can still poison KB by asking the right question. Pruning: `DELETE FROM knowledge_base WHERE category='web';` clears all web-sourced rows in one command.

## Supply chain

No npm dependencies. Runtime is vanilla Workers JS + Workers AI bindings. Frontend pulls 3 CDN libraries (pdf.js, mammoth, SheetJS) — pinned to specific minor versions in `ai-kb/public/index.html`. Bumping these without integrity hashes is a finding.

GHA actions: `actions/checkout@v4`, `anthropics/claude-code-action@v1`. SHA-pinning would be safer but the repo currently uses tag-pinning consistently.
