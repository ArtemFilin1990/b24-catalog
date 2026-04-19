# kb-audit — review checklist (repo-specific)

A checklist the reviewer walks top-down. Skip items that don't apply.

## 1. Scope

- [ ] One logical concern per PR (schema OR worker OR prompt, not all three).
- [ ] Change set fits the PR title.
- [ ] No unrelated refactors, reformatting, or package bumps mixed in.
- [ ] If the change spans both root and `ai-kb/`, both deploy workflows will fire (`deploy.yml` uses `paths-ignore: ai-kb/**`, `deploy-ai-kb.yml` uses `paths: ai-kb/**`) — that is expected; flag only if one side is broken by the other.

## 2. D1 / SQL

- [ ] All new tables/views/indexes are declared in `migrations/*.sql` or `ai-kb/migrations/*.sql`. No runtime `CREATE TABLE` outside the grandfathered `ensureSettingsTable`.
- [ ] Fresh-DB bootstrap works in the documented order: root `0001_root_schema.sql` → root `0002_rate_limit.sql` → ai-kb `0001_initial.sql` → `0002_files_rules_catalog.sql` → `0003_catalog_staging.sql` → `0004_catalog_master_view.sql`.
- [ ] Existing-DB upgrade is idempotent (`IF NOT EXISTS` / `INSERT OR IGNORE` where a re-run is expected).
- [ ] FK cascades are accompanied by `PRAGMA foreign_keys = ON` at the top of the same migration (D1 does not enforce FKs by default).
- [ ] `schema_migrations` inserts only belong in root migrations; ai-kb migrations intentionally do not insert there.
- [ ] Views do not emit duplicate logical rows; raw `id` is not assumed globally unique when two source tables can overlap.
- [ ] See `.claude/skills/d1-migration-safety` for the deep check.

## 3. Cloudflare workers

- [ ] `wrangler.toml` bindings match runtime usage (`DB`, `R2`, `VECTORIZE`, `AI`, `ASSETS`).
- [ ] No hardcoded secrets, no tokens in code, no admin bypass branches.
- [ ] New admin route goes through `requireAdmin(request, env)` (root uses `safeEqual` + `Bearer` support; ai-kb uses `===` with `X-Admin-Token` only — keep them separate).
- [ ] `POST /api/admin/upload-catalog` remains the only user of `requireUpload`; do not broaden the upload scope.
- [ ] Every privileged action is followed by `ctx.waitUntil(audit(env, request, <action>, <resource>, <meta>))`.
- [ ] `deploy-ai-kb.yml` retry/self-heal loop and pinned `wrangler@4.83.0` are intact.
- [ ] Native CF Git build must remain disabled for the `ai-kb` service.
- [ ] See `.claude/skills/cloudflare-worker-review` for the deep check.

## 4. ai-kb content pipeline

- [ ] New KB ingest filters embeddings to `EMBED_DIMS = 1024` before `VECTORIZE.upsert`.
- [ ] `/api/reindex` still respects `REINDEX_CHUNKS_PER_CALL = 12`.
- [ ] Staging → normalized → view pipeline stays one-way; bots read from `catalog_master_view` (when populated) or `catalog`, never from `staging_catalog_import`.
- [ ] See `.claude/skills/catalog-import-review`.

## 5. Bearing answers

- [ ] No cross-type analog mapping (ball ↔ roller ↔ thrust ↔ tapered).
- [ ] Geometry equality is strict (`d`, `D`, `B/T` all equal).
- [ ] Status vocabulary kept: `ПОДТВЕРЖДЕНО | ТРЕБУЕТ_ПРОВЕРКИ | ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ | ОТКЛОНЕНО`.
- [ ] Commercial data (цена, наличие, срок) routed to "Требует подтверждения менеджером".
- [ ] See `.claude/skills/bearing-analog-check`.

## 6. Frontend (ai-kb)

- [ ] Admin token still stored in `sessionStorage['ai-kb-admin']`, not `localStorage`.
- [ ] Attachments still go as separate `attachment_text` / `images` fields, not spliced into message history.
- [ ] Markdown rendering still happens only after stream end (`renderMarkdown` rewrites the bubble).

## 7. Docs

- [ ] `CLAUDE.md` updated if the change adds/removes a convention, binding, endpoint, or skill.
- [ ] `docs/RUNBOOK.md` updated if the change affects secrets, deploy procedure, or migration order.
- [ ] `ai-kb/migrations/README.md` updated if migration order changes.
