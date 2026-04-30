# `.claude/skills/` — skills architecture

Local skills are lightweight, repo-specific playbooks. An agent loads the matching skill **before** generic reasoning and follows its checklist, references, and scripts.

## Layout (mandatory)

Every skill lives in its own directory with three parts:

```
.claude/skills/<skill-name>/
├── SKILL.md                # frontmatter (name, description) + when-to-use + workflow + output contract
├── references/             # short, authoritative rule sheets (markdown)
│   └── *.md
└── scripts/                # executable helpers — static checks or smoke tests
    └── *.sh                # POSIX sh for review skills, bash for live-worker scripts
```

`SKILL.md` **must** start with frontmatter:

```
---
name: <kebab-case, matches directory name>
description: <single sentence; starts with a verb; mentions the trigger domain>
---
```

Agents discover skills by their frontmatter and the `description` text in `CLAUDE.md`'s "Local skills" section — both must stay in sync.

## Catalog

Nine skills, two categories:

### Build / extend (generative)
| Skill | Fires when the user asks to… |
|---|---|
| `ai-kb-chatbot-build` | create/extend/fix the Everest bearing chatbot (`ai-kb` worker): memory, RAG, admin settings, ingest, bearing answers. |

### Review / validate (gate)
| Skill | Fires when the change touches… |
|---|---|
| `kb-audit` | any PR — overall scope, merge decision, rollback risk (meta-skill; composes the ones below). |
| `cloudflare-worker-review` | `src/index.js`, `ai-kb/src/*.js`, `wrangler.toml`, `.github/workflows/deploy*.yml`, admin/auth, bindings, secrets. |
| `d1-migration-safety` | `migrations/*.sql`, `ai-kb/migrations/*.sql`, any new CREATE TABLE/VIEW/INDEX. |
| `catalog-import-review` | `/api/imports*`, `staging_catalog_import`, `catalog_rows`, `catalog_master_view`, import/normalize/view layer. |
| `bearing-analog-check` | `AI_SYSTEM` prompt, `searchCatalog`, `catalogRowToText`, analog tables, any PR that changes how the bot picks ГОСТ↔ISO equivalents. |
| `security-engineer` | new `/api/*` route, auth helpers, secrets, third-party fetch with API key, anything LLM-context-related (prompt-injection, KB poisoning surface). |
| `sre` | deploy workflow, error handling around `env.AI/VECTORIZE/DB`, `ctx.waitUntil` callsites, observability headers, rate-limit thresholds, backup cron. |
| `database-optimizer` | new SQL, new index/FK, GLOB/LIKE/FTS5 query, `env.VECTORIZE.*` callsite, `searchCatalog`/`searchKnowledge` change. |

## Composition rules

Skills compose. A PR that adds a new admin route which touches a new migration and changes the bearing prompt should load, in order:

1. `kb-audit` — top-level scope and merge-decision framework.
2. `cloudflare-worker-review` — for the admin route.
3. `security-engineer` — adversarial pass on the new route + any new secret/auth surface.
4. `d1-migration-safety` — for the migration shape (idempotency, FK pragma, schema_migrations).
5. `database-optimizer` — for query plans, indexes, vector dim/metadata of the new shape.
6. `catalog-import-review` — if the migration is about staging/normalized/view layer.
7. `bearing-analog-check` — for the prompt/analog change.
8. `sre` — for any change that adds an `await` in the chat hot path, raises a timeout, or modifies the deploy workflow.
9. `ai-kb-chatbot-build` — only if the change is inside `ai-kb/`.

Do not copy-paste content across skills. Cross-reference with relative paths:

```
See `.claude/skills/d1-migration-safety/references/bootstrap-safety.md`.
```

## Decision tree

```
user request
 └── is it "create/extend chatbot / memory / RAG / bearing answers"?
      ├── yes → ai-kb-chatbot-build   (generative)
      └── no  → is it a PR review or risk check?
                ├── yes → kb-audit (top)
                │         ├── worker/auth/deploy change?           → cloudflare-worker-review
                │         ├── new auth surface / secret / route?   → security-engineer
                │         ├── SQL migration?                       → d1-migration-safety
                │         ├── new SQL query / index / vector op?   → database-optimizer
                │         ├── import/staging/view SQL?             → catalog-import-review
                │         ├── bearing analog/prompt?               → bearing-analog-check
                │         └── deploy yaml / hot-path latency / ctx.waitUntil? → sre
                └── no  → no skill required; use general reasoning
```

## Output contract (all review skills)

Every review skill returns the same shape so a reviewer can scan them uniformly:

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

Generative skills (`ai-kb-chatbot-build`) use a different, action-oriented shape documented inside the skill.

## Scripts

- `scripts/*.sh` must be executable (`chmod +x`) and pass `bash -n` / `sh -n`.
- Review-skill scripts are **static checks** that work offline (grep/find/awk against repo files) — they must never require network or secrets.
- Live-worker scripts (only in `ai-kb-chatbot-build`) may hit `https://ai-kb.35ewerest.workers.dev` and need `ADMIN_TOKEN`.
- All scripts must accept repo-root as default working directory and exit non-zero on the first detected issue.

## When to add a new skill

Add a skill only when the domain is:

- **recurring** — the agent will need it across many PRs or sessions;
- **repo-specific** — generic reasoning produces wrong answers here (e.g. "D1 doesn't enforce FKs by default");
- **self-contained** — the trigger criteria fit one sentence.

Otherwise, extend an existing skill's references or add a new `references/*.md` instead of creating a new skill directory.

## When to remove a skill

Remove (or merge into another) when:

- the covered feature is gone from the repo;
- two skills have overlapping triggers and identical advice;
- the skill has not been cited in any PR review or change for 6+ months.

Always update `CLAUDE.md` in the same PR as any skill add/remove/rename so the catalog stays in sync.
