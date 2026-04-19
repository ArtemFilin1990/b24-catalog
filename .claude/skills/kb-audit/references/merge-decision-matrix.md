# kb-audit — merge decision matrix

## APPROVE

Require all of:

- No blockers from any specialist skill.
- Fresh-DB bootstrap passes (walk the documented migration order mentally or via `scripts/review_pr.sh`).
- Upgrade path is idempotent; re-running migrations does not corrupt data.
- Scope is coherent — one concern per PR.
- `CLAUDE.md` / `docs/RUNBOOK.md` / migration README are updated when conventions, bindings, or deploy steps change.

Phrasing: `APPROVE` — short, cite at least one load-bearing change (`path:line`).

## APPROVE WITH FIXES

Use when the change is directionally correct but has small, local issues:

- Missing audit call on a new admin route → tell the author to add `ctx.waitUntil(audit(...))`.
- `CLAUDE.md` forgot a new binding or endpoint.
- Cosmetic SQL issue (comment does not match behavior, no functional risk).
- Reindex/embed change that works today but will break a future larger KB row — flag the benchmark expectation.

Do NOT use `APPROVE WITH FIXES` for anything that can leave the DB, a secret, or an admin route in a bad state at merge time. Those are `REQUEST CHANGES`.

## REQUEST CHANGES

Any of these is a hard gate:

- Fresh-DB bootstrap fails (missing helper table, ordering dependency).
- Existing-DB migration is not idempotent where a re-run is expected.
- View or staging promotion can produce duplicate logical rows.
- Vector ID collision risk (`kb-<id>-<chunk>` vs another namespace).
- Hardcoded secret, new `safeEqual` bypass, or admin-scope broadening.
- New admin route without audit.
- `deploy-ai-kb.yml` retry loop or `wrangler@4.83.0` pin removed.
- Cross-type bearing analog in the prompt or an analog table.
- Runtime `CREATE TABLE` added when a migration file exists (exception: `ensureSettingsTable` is grandfathered).

## Scope-split guidance

If the PR mixes unrelated concerns (schema + auth + prompt), ask for:

1. `cherry-pick` the self-contained fix (usually the security/schema one) first.
2. Leave the prompt/UX change in the trailing PR.

Prefer cherry-pick over "merge and fix in follow-up" — D1 and deployed Workers state is shared across both workers, so a bad migration lands everywhere immediately.

## Wording template

```
Decision: <verdict>

Why:
- <one-line driver>
- <one-line driver>

Blocking fixes:
- <path:line — concrete change>

Non-blocking improvements:
- <path:line — concrete change>

Merge recommendation: <squash | rebase | cherry-pick:<SHA> | hold until <X>>
```
