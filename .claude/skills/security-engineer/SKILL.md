---
name: security-engineer
description: Adversarial review of b24-catalog / ai-kb worker changes — auth, secrets, prompt-injection, supply chain, IDOR, rate-limit bypass — sized for a Cloudflare Workers + D1 + Vectorize codebase, not a generic web app.
---

Use this skill when the PR touches any of:

- new or changed `/api/*` route in `src/index.js` or `ai-kb/src/index.js`
- `requireAdmin`, `requireUpload`, `resolveUser`, `safeEqual`, `safeEqHex`, `validateCredentials`, `extractBearer`
- `ai-kb/src/auth.js` (PBKDF2, session tokens), `ai-kb/src/web_search.js`, `ai-kb/src/ratelimit.js`
- `AI_SYSTEM` prompt or any string that the LLM treats as instructions
- new secrets / `wrangler secret put`, `env.*` reads
- new third-party fetch (especially with API key headers)
- any code path that can write to `knowledge_base`, `chat_sessions`, `users`, `user_sessions`, `admin_audit_log`

This skill complements `cloudflare-worker-review` — that one checks bindings/routing/deploy hygiene; this one thinks like an attacker.

## Pre-flight

1. Read `CLAUDE.md` §"Admin auth + audit" for the live trust boundaries.
2. Read `references/known-incidents.md` (this directory) — at least three Cloudflare API tokens have been leaked through transcript history; rotation discipline is non-negotiable.
3. Read `references/threat-model.md` — STRIDE applied to this specific worker.

## Adversarial questions for every change

Apply in order. Skip with justification, don't skip silently.

1. **What can be abused?** Every new field on a request body, every new query param, every new header. List the abuse cases.
2. **What happens when this fails?** AI returns garbage / Brave times out / D1 unreachable / vectorize down — does the failure mode leak data, escalate privilege, or just degrade?
3. **Who benefits from breaking this?** A regular logged-in user trying to escalate? A scraper trying to exfil the catalog? An attacker poisoning answers for the next user?
4. **What's the blast radius?** A compromised single chat: just that user. A compromised auto-ingest: all future chats. A compromised admin token: everything.

## Hard rules — block merge if violated

- **No hardcoded secrets / tokens / credentials.** Includes `cfat_*`, `Bearer ey…`, any `'sk-…'`, `password = '…'`. Search the whole diff, not just changed files. If a secret slipped in, it must be rotated even after removal.
- **All user input is hostile.** Validate at the trust boundary (the handler). String-coerce, length-cap, regex-whitelist. Body fields without `String(body?.x || '').slice(0, N)` or equivalent are a finding.
- **No string concatenation in SQL.** Every `env.DB.prepare(...)` must use `?` placeholders + `.bind()`. The repo already follows this — call out any regression.
- **Constant-time compare for tokens.** `safeEqual` (root, ASCII) and `safeEqHex` (ai-kb auth). Never `===` for tokens, never `crypto.subtle.timingSafeEqual` (not portable per CLAUDE.md).
- **Default deny on auth.** New mutating route → `requireAdmin` OR `resolveUser` first. Read-only catalog feeds (`/api/imports`, `/api/orders POST`, `/api/health`, `/api/stats`, `/api/search`, `/api/settings GET`) are intentional exceptions; widening this list needs explicit justification.
- **Audit privileged writes.** Any new code path that passes `requireAdmin` in the root worker should `ctx.waitUntil(audit(env, request, …))`. ai-kb intentionally has no audit table; if you add one there, propose schema first.
- **Rate-limit expensive endpoints.** Anything that calls `env.AI.run`, `env.VECTORIZE.upsert`, or fetches a paid third-party API — wrap with `checkRate(env.DB, bucketForRequest(request, '<endpoint>'), N, windowSec)`. Admins can bypass.
- **Default deny on identity.** Bearer token format must match `^Bearer\s+([A-Fa-f0-9]{32,128})$`. If a new auth header bypasses `extractBearer` / `resolveUser`, that's a regression.
- **`pull_request_target` ↔ allowlist.** External-review workflow runs in base trust boundary; if it ever shells `gh pr comment` again, that's a known prompt-injection → secret exfil channel (PR #54 history). Keep the inline-comment MCP only.

## LLM-specific defenses (this codebase, not generic OWASP)

- **Untrusted context is wrapped.** Web hits (`webHits`) and auto-learned `knowledge_base` rows with `category='web'` must be inside `=== UNTRUSTED_WEB_BEGIN ===` / `=== UNTRUSTED_WEB_END ===`, with `sanitizeForUntrustedBlock()` applied at both persist time (in `autoIngestWebHits`) and read time (in `buildContext`). The sanitizer breaks literal markers + collapses `===+` runs so an attacker can't close the sandbox from inside.
- **Auto-learn write path is admin-or-allowlist.** `handleChat`'s `canAutolearn = isAdmin || allowedAutolearnUsers.has(user.username)`. Any change that broadens this is a finding — review `references/threat-model.md` §"KB poisoning".
- **System prompt is data, not concatenation.** `AI_SYSTEM` lives in `src/index.js` as a const; production overrides via `settings.system_prompt`. Don't introduce string-format slots in the prompt that take user input verbatim.
- **Image vision describes, doesn't act.** `describeImage` returns text only — a vision response that includes `gh ...` style commands or URLs to fetch is just text, not a tool call. If we ever add tool-use, this assumption must be re-checked.

## Severity scale (use this exact wording in findings)

| Severity | Examples in this repo |
|---|---|
| **Critical** | Auth bypass, secret exfil channel, SQL injection, RCE through `eval()` of body, KB write without admin/allowlist |
| **High** | IDOR on `/api/sessions/:id`, missing rate-limit on chat, prompt-injection that survives to next chat, leaked `BRAVE_API_KEY` |
| **Medium** | Missing `X-Sources-*` observability, unsanitized markdown render in UI, verbose error message that leaks worker internals |
| **Low** | Missing CSP / X-Frame-Options on static UI, log lines that include opaque tokens (truncate to 8 chars before logging) |
| **Informational** | Defense-in-depth nice-to-haves, naming consistency |

Always include: file path:line, attack scenario in one sentence, copy-paste remediation diff.

## Output contract

```
Decision: APPROVE | APPROVE WITH FIXES | REQUEST CHANGES

Why:
- <one-line per driver, severity-tagged>

Blocking fixes:
- <Critical/High — file:line — concrete change>

Non-blocking improvements:
- <Med/Low/Info — file:line — concrete change>

Merge recommendation:
- <squash | rebase | hold for rotation>
```

If a finding requires a credential rotation as part of remediation, say so explicitly in "Why" — this repo has missed rotations before.
