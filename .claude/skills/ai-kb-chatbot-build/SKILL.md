---
name: ai-kb-chatbot-build
description: Build, extend, or fix the Everest bearings AI chatbot (ai-kb worker) on Cloudflare Workers AI with D1 memory, Vectorize KB RAG, R2 documents, and bearing analog logic. Use for requests to create/update a chat bot with memory and sensible answers about bearings and analog lookup.
---

Use this skill when the user asks to:
- create, deploy, fix, or extend the Everest AI chatbot (`ai-kb.35ewerest.workers.dev`)
- add conversation memory (D1) or RAG over the knowledge base (Vectorize + R2)
- improve bearing identification, ГОСТ⇄ISO analog answers, or the system prompt
- wire or audit admin endpoints for the chatbot (settings, file registry, ingest)

## Prime directive

The Everest chatbot **already exists** in this repo as the `ai-kb` worker (`ai-kb/src/index.js`, `ai-kb/wrangler.toml`, `ai-kb/migrations/*`). Extend it. Do **not**:
- scaffold a second chatbot worker
- move chat into the root `b24-catalog` worker (its job is catalog + imports + orders)
- invent new D1 bindings, Vectorize indexes, or R2 buckets
- copy `skill-packs/ewerest-ai-chatbot/src/*` into production (see `skill-packs/ewerest-ai-chatbot/INTEGRATION.md`)

## Fixed production facts (do not change without explicit migration)

- Account: `84cbacc4816c29c294101ec57a0bea5d`
- D1 `baza` id: `11a157a7-c3e0-4b6b-aa24-3026992db298`
- R2 bucket: `vedro` (binding name `CATALOG`)
- Vectorize index: `ai-kb-index` — 1024 dim, cosine (matches `@cf/baai/bge-m3`)
- Chat model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Embedding model: `@cf/baai/bge-m3`
- Vision model: `@cf/meta/llama-3.2-11b-vision-instruct`
- Prod URL: `https://ai-kb.35ewerest.workers.dev/`
- Admin auth: `X-Admin-Token` header (ai-kb) — **not** `Authorization: Bearer`

## Pre-flight checklist (before any change)

1. Read `CLAUDE.md` and `docs/RUNBOOK.md`.
2. Read `ai-kb/src/index.js` — single-file worker; router, chat, ingest, reindex, settings.
3. Read `ai-kb/src/files.js` — admin file registry (upload to R2, metadata in D1 `files`).
4. Read `ai-kb/wrangler.toml` — confirm bindings `DB` (D1), `CATALOG` (R2, bucket `vedro`), `VECTORIZE`, `AI`, `ASSETS`.
5. Check applied D1 state: `SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name` (ai-kb migrations do not record to `schema_migrations`).
6. If touching bearing answers, load the `bearing-analog-check` skill first.
7. If touching migrations, load the `d1-migration-safety` skill.
8. If touching Worker routes / auth / deploy, load the `cloudflare-worker-review` skill.

## Build/extend routing

| User intent | Action |
|---|---|
| "create bot from scratch" | Reject the literal ask. Point to the existing `ai-kb` worker. Offer to extend it instead. |
| "add memory" | Already present (`chat_sessions` + `chat_messages` in `ai-kb/migrations/0001_initial.sql`, persisted via `stream.tee()` in `handleChat`). Verify `ensureSession` / `saveMessages` are wired for any new chat route. |
| "add RAG / Vectorize" | Already present (`searchKnowledge` at `ai-kb/src/index.js`). To add new KB content use `POST /api/ingest` (admin); to re-embed existing rows use `POST /api/reindex?after_id=0&chunk_from=0` looped client-side. Do not raise `REINDEX_CHUNKS_PER_CALL = 12` without benchmarking. |
| "improve bearing answers" | Edit `AI_SYSTEM` constant **and/or** push `settings.system_prompt` via `POST /api/settings`. Live prompt is the D1 override if set. Apply `bearing-analog-check` rules. |
| "tune temperature / topK" | `POST /api/settings` with `temperature`, `max_tokens`, `catalog_topk`, `vector_topk`. Use `??` semantics: `0` disables a leg, `null/empty` clears the override. |
| "upload documents" | Admin file registry: `POST /api/admin/files/upload` (multipart). PDF/DOCX/XLSX text extraction happens **client-side** in `ai-kb/public/app.js` (pdf.js, mammoth, SheetJS). |
| "seed catalog" | Catalog lives in D1 `catalog` (normalized by root worker imports). Do not seed here. See `catalog-import-review` skill. |

## Memory + RAG contract

See `references/memory-and-rag.md`. One-liner: on `POST /api/chat` the worker pulls `messages[]` (last 20, user/assistant only), runs catalog FTS + Vectorize KB queries **in parallel** on the pure user question, optionally describes attached images via vision, assembles `Контекст: / Прикреплённые документы: / Описание изображений: / Вопрос:` blocks, and streams the response with `stream.tee()` so one copy is persisted to `chat_messages`.

## Bearing answer rules (enforced in `AI_SYSTEM`)

- Decompose obozначение into префикс / ядро / суффиксы before answering.
- Type is determined by ISO series (6xxx → радиальный шариковый, 22/23xxx → сферический роликовый, 30/31/32xxx → конический, NU/NJ/N/NF/NUP → цилиндрический, 51–54xxx → упорный шариковый, 80/81xxx → упорный роликовый).
- Ball ≠ roller. Dimensions alone never justify a cross-type analog.
- Use the kind-of-ГОСТ↔ISO crossreferences already in `AI_SYSTEM`; do not invent new ones.
- Status: `ПОДТВЕРЖДЕНО | ТРЕБУЕТ_ПРОВЕРКИ | ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ | ОТКЛОНЕНО`.
- Commercial (цена/наличие/срок) → "Требует подтверждения менеджером".

## Output format

```
Решение: <одна строка>

Шаги:
1. ...

Эффект: <что изменится для пользователя бота>

Риски: <P0/P1/P2, только конкретные>

Проверка: <curl/sql команды, взятые из docs/RUNBOOK.md или scripts/smoke_chat.sh>
```

## Smoke test

After any change touching chat/settings/ingest, run `scripts/smoke_chat.sh`. It validates `/api/health` model tag, `/api/chat` SSE round-trip with a throwaway session, and `/api/settings` admin read.

## References

- `references/architecture.md` — bindings, models, routes, file layout.
- `references/memory-and-rag.md` — D1 tables used by chat, FTS fallback, Vectorize query, prompt assembly.
- `references/bearing-logic.md` — link to `bearing-analog-check` skill + live prompt rules.
- `skill-packs/ewerest-ai-chatbot/INTEGRATION.md` — what NOT to copy from the donor pack.
- `docs/RUNBOOK.md` — secrets rotation, migrations order, deploy procedure.

## Scripts

- `scripts/smoke_chat.sh <base_url> [admin_token]`
