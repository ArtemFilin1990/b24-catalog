---
name: kb-audit
description: Top-level PR review skill for b24-catalog / ai-kb — enforces scope discipline, composes the specialist skills (d1-migration-safety, cloudflare-worker-review, catalog-import-review, bearing-analog-check), and returns a single merge decision.
---

Use this skill whenever you are asked to:

- review a pull request in this repo;
- judge merge risk after code has already been committed;
- decide between `APPROVE`, `APPROVE WITH FIXES`, `REQUEST CHANGES`;
- triage a change that touches multiple concerns (schema + worker + prompt).

## Role

`kb-audit` is the **meta-skill**. It never does the deep domain check itself — it delegates to:

| If the PR touches… | Load also |
|---|---|
| `migrations/*.sql`, `ai-kb/migrations/*.sql`, or any new `CREATE TABLE/VIEW/INDEX` | `.claude/skills/d1-migration-safety` |
| `src/index.js`, `ai-kb/src/*.js`, `wrangler.toml`, `.github/workflows/deploy*.yml`, auth/secrets | `.claude/skills/cloudflare-worker-review` |
| staging / normalized catalog / `catalog_master_view` | `.claude/skills/catalog-import-review` |
| `AI_SYSTEM`, `searchCatalog`, analog tables, the bot prompt | `.claude/skills/bearing-analog-check` |
| any greenfield bot code inside `ai-kb/` | `.claude/skills/ai-kb-chatbot-build` |

## Pre-flight checklist

1. `git log --stat origin/main..HEAD` (or the PR's base..head). Keep the file list in mind.
2. `CLAUDE.md` is the source of truth for conventions — re-read the section matching the change.
3. `docs/RUNBOOK.md` is the source of truth for ops — read before judging deploy/secret changes.
4. Memory of the repo:
   - Two workers share one D1: `b24-catalog` (root `src/`, `wrangler.toml`) + `ai-kb` (`ai-kb/`).
   - D1 id: `11a157a7-c3e0-4b6b-aa24-3026992db298`, R2: `vedro`, Vectorize: `ai-kb-index` (1024/cosine).
   - `schema_migrations` records root migrations only; ai-kb migrations are idempotent-by-shape.
   - No bundler, no tests, no package.json at the runtime layer — `wrangler deploy` ships what's on disk.

## Scope rules

- **One concern per PR.** A PR that touches both `migrations/0002_*` and `AI_SYSTEM` and a new `/api/admin/*` route is a split candidate; ask for cherry-pick.
- **No drive-by refactors.** Cosmetic rewrites inside the same PR as a security or schema change hide risk.
- **No silent runtime-only table creation** when the migration layer exists (`ensureSettingsTable` is grandfathered; new tables must land in migrations).
- **No hardcoded secrets** — the upload endpoint's old hardcoded token is in git history; rotate if re-introduced.
- **Narrow admin scope.** Anything new that guards sensitive data belongs behind `requireAdmin`, not `requireUpload`.

## Cross-cutting red flags

- New `CREATE TABLE IF NOT EXISTS` in `src/*.js` without a matching migration file.
- New Vectorize upserts where the embedding dimension is not filtered to `EMBED_DIMS = 1024`.
- New admin route without `ctx.waitUntil(audit(env, request, ...))`.
- `deploy-ai-kb.yml` edited to drop the title-retry loop or un-pin wrangler.
- Any change that depends on `schema_migrations.version` reflecting ai-kb state (it does not).

## Output contract

Use the shape defined in `.claude/skills/README.md`:

```
Decision: APPROVE | APPROVE WITH FIXES | REQUEST CHANGES

Why:
- <one-line justification per driver>

Blocking fixes:
- <path:line — concrete change>

Non-blocking improvements:
- <path:line — concrete change>

Merge recommendation:
- <squash | rebase | cherry-pick | hold>
```

Never return a decision without at least one concrete citation (`path:line`). "Looks good" is not a review.

## References

- `references/review-checklist.md` — expanded checklist tied to real repo paths.
- `references/merge-decision-matrix.md` — when to escalate from APPROVE WITH FIXES to REQUEST CHANGES.

## Scripts

- `scripts/review_pr.sh [base_ref]` — prints the changed files, which specialist skills should load, and the highest-risk files in the PR.
