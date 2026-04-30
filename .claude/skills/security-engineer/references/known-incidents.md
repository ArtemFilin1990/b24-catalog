# Known incidents — what has actually gone wrong here

History of real findings in this repo, kept current so reviewers don't
re-discover the same problems. Add a row whenever something blocks merge or
required rotation.

## Token leaks

- **Hardcoded upload token in `/api/admin/upload-catalog`** — discovered in git history. Removed; never reintroduce a hardcoded fallback. Any token that ever existed in a file in `git log -p` must be considered burned.
- **`CLOUDFLARE_API_TOKEN` exported in shell history** — `~/.claude/projects/<repo>/*.jsonl` transcripts captured `export CLOUDFLARE_API_TOKEN='cfat_…'` >1700 times across three different tokens (`cfat_yiO…`, `cfat_qCI…`, `cfat_eG4…`). Discovered by `fewer-permission-prompts` skill scan. Mitigation:
  - Rotate via Cloudflare Dashboard → My Profile → API Tokens → Roll token.
  - Use `wrangler secret put` instead of `export` in interactive shells.
  - Don't paste tokens into chat — pass file paths or env-var names.
- **GHA preflight regression** — `deploy-ai-kb.yml` once hit `/user/tokens/verify` with an account-scoped token; CF returns code 1000 ("token invalid") even when the token works. Fix: hit `/accounts/{id}/tokens/verify`. Don't revert.

## Prompt injection / KB poisoning

- **PR #54** — `external-review.yml` originally allowed `Bash(gh pr comment:*)`; under `pull_request_target` this was a shell-level write path that an attacker could direct via prompt injection in the PR body to publish `$ANTHROPIC_API_KEY` as a comment. Removed; only the inline-comment MCP and `gh pr view` remain. Don't re-add `gh pr comment` unless there's a way to scope it to a hardcoded body template.
- **PR #55** — web-search hits were spliced raw into the user message; an SEO-manipulated snippet could hijack the system prompt. Mitigated with `=== UNTRUSTED_WEB_BEGIN/END ===` delimiters + `sanitizeForUntrustedBlock()` to neutralise the markers themselves. Auto-learn additionally is admin-or-allowlist gated to prevent regular users from poisoning shared `knowledge_base`. The retrieval path also re-wraps `category='web'` rows so the protection survives across chats.
- **Self-heal pattern** — `ensureSettingsTable`, `ensureAuthTables`. CLAUDE.md flags as "wart" — accepted because it unblocks production when migrations weren't applied yet. Don't propagate to non-bootstrap tables.

## Auth model evolution

- **Pre-PR #45** — anyone who knew a session UUID could write into another user's chat (no `client_id` ownership check in `ensureSession`). Fixed: `ensureSession` returns `'forbidden'` sentinel on mismatch; admin bypasses.
- **Pre-PR #46** — auth modal didn't actually hide on success because `.auth-overlay { display: flex }` overrode `[hidden]`. Global `[hidden] { display: none !important }` rule added. Same bug class also silently broke `#back-btn`.

## D1 schema drift

- ai-kb migrations 0006 + 0007 were committed but the worker deployed before they were applied to prod D1, breaking login/register and chat persistence. Hot-fixed with self-heal (`ensureAuthTables` also runs `ALTER TABLE chat_sessions ADD COLUMN client_id` if missing). Long term: order migration apply before deploy in the runbook.

## Operational

- **Cloudflare native Git integration clobbers `ai-kb`** — built the wrong wrangler.toml and replaced ai-kb assets with the catalog HTML. Mitigation: native CI for ai-kb is disabled at account level (build-trigger DELETE'd), GHA is the only deploy path. If ai-kb regresses to the catalog UI, the trigger has been re-enabled — disable again.
