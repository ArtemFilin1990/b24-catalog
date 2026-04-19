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

Six skills, two categories:

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

## Composition rules

Skills compose. A PR that adds a new admin route which touches a new migration and changes the bearing prompt should load, in order:

1. `kb-audit` — top-level scope and merge-decision framework.
2. `cloudflare-worker-review` — for the admin route.
3. `d1-migration-safety` — for the migration.
4. `catalog-import-review` — if the migration is about staging/normalized/view layer.
5. `bearing-analog-check` — for the prompt/analog change.
6. `ai-kb-chatbot-build` — only if the change is inside `ai-kb/`.

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
                │         ├── worker/auth/deploy change? → cloudflare-worker-review
                │         ├── SQL migration?             → d1-migration-safety
                │         ├── import/staging/view SQL?   → catalog-import-review
                │         └── bearing analog/prompt?     → bearing-analog-check
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
