# ai-kb chatbot — real architecture

Single Cloudflare Worker: `ai-kb` (dir: `./ai-kb`). Serves chat UI + API.

## Bindings (see `ai-kb/wrangler.toml`)

| Binding | Kind | Name / id |
|---|---|---|
| `DB` | D1 | `baza` (`11a157a7-c3e0-4b6b-aa24-3026992db298`) — shared with root worker |
| `R2` | R2 | `vedro` — shared with root worker |
| `VECTORIZE` | Vectorize | `ai-kb-index`, dim 1024, cosine |
| `AI` | Workers AI | — |
| `ASSETS` | Static | `./ai-kb/public` |

Account: `84cbacc4816c29c294101ec57a0bea5d`.

## Models

| Role | Model | Why |
|---|---|---|
| Chat | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Can distinguish bearing types under RAG noise (8B could not) |
| Embeddings | `@cf/baai/bge-m3` | Multilingual (RU+EN), 1024-dim — matches `ai-kb-index` |
| Vision | `@cf/meta/llama-3.2-11b-vision-instruct` | Described image → spliced into user message before the chat call |

Do not switch the embedding model without also re-creating the Vectorize index with matching dimensions — `env.VECTORIZE.upsert` rejects vectors of the wrong length; ai-kb already filters with `values.length === EMBED_DIMS`.

## Routes (all under `ai-kb.35ewerest.workers.dev`)

### Public
- `POST /api/chat` — SSE stream. Body: `{ messages:[{role,content}], session_id?, attachment_text?, images?:[{name,dataUrl}] }`. Rate-limited to 30 req/min per IP (admins bypass). Response streams raw SSE from Workers AI.
- `GET  /api/search?q=...` — FTS+Vectorize combined, no LLM.
- `GET  /api/stats` — counts + `VECTORIZE.describe()`.
- `GET  /api/health` — `{ model, embed }`.
- `GET  /api/settings` — read-only current settings with defaults merged in.
- `GET  /api/sessions` — list sessions (public list is acceptable since sessions contain only bearing questions).
- `GET  /api/sessions/:id/messages` — thread view.

### Admin (`X-Admin-Token: $ADMIN_TOKEN`)
- `POST   /api/settings` — upsert `system_prompt`, `temperature`, `max_tokens`, `catalog_topk`, `vector_topk`. Empty string clears override.
- `POST   /api/ingest` — append a doc to `knowledge_base` and index to Vectorize. Body: `{ title, text, category?, source? }`.
- `POST   /api/reindex?after_id=N&chunk_from=M` — resumable re-embed loop. Client must iterate because budget per call is `REINDEX_CHUNKS_PER_CALL = 12` (CPU).
- `POST   /api/admin/files/upload` — multipart, originals to R2, metadata in `files`.
- `GET    /api/admin/files` — list.
- `DELETE /api/admin/files/:id` — remove.
- `GET    /api/admin/storage/stats` — R2 + D1 size.
- `DELETE /api/sessions/:id` — admin-only session wipe.

### Static
Any non-`/api/*` path falls through to `env.ASSETS.fetch(request)` which serves `ai-kb/public/` (index.html, app.js, css).

## File layout

```
ai-kb/
├── wrangler.toml                     # name=ai-kb; no build step
├── migrations/
│   ├── 0001_initial.sql              # knowledge_base+kb_fts, chat_sessions, chat_messages, query_log
│   ├── 0002_files_rules_catalog.sql  # files, file_extracts, kb_chunks, bearing_rules, catalog_rows, admin_audit_log
│   ├── 0003_catalog_staging.sql      # staging_catalog_import
│   └── 0004_catalog_master_view.sql  # catalog_master_view (read model)
├── public/
│   ├── index.html                    # chat UI
│   ├── app.js                        # IIFE; client-side PDF/DOCX/XLSX extraction; sessionStorage admin token
│   └── styles.css
└── src/
    ├── index.js                      # router + chat + ingest + reindex + settings (~767 lines)
    ├── files.js                      # admin file registry
    └── ratelimit.js                  # D1-backed sliding-window limiter
```

## Deploy

- `cd ai-kb && npx wrangler deploy` (local).
- CI: `.github/workflows/deploy-ai-kb.yml` on every push touching `ai-kb/**` and on `*/15 * * * *` cron as self-heal with pre-flight account-scoped `/accounts/.../tokens/verify` and title-retry loop. Pin `wrangler@4.83.0`.
- **Do not** enable Cloudflare's native Git build integration for `ai-kb` — it will push the root `b24-catalog` bundle over it.

## Secrets

- `ADMIN_TOKEN` — required for every admin route.
- If deployed worker refuses a plain `wrangler secret put` ("latest version isn't currently deployed"), use `wrangler versions secret put` + `wrangler versions deploy <id> -y`.

## Reference — Cloudflare docs

- Workers AI Get Started: https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/
- Vectorize: https://developers.cloudflare.com/vectorize/
- D1: https://developers.cloudflare.com/d1/
- R2: https://developers.cloudflare.com/r2/
