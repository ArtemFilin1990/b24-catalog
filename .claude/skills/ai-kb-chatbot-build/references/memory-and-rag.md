# Memory + RAG pipeline (as built)

## Session memory

Two D1 tables (`ai-kb/migrations/0001_initial.sql`):

- `chat_sessions (id TEXT PK, title, message_count, created_at, updated_at)`
- `chat_messages (id, session_id FK, role, content, sources INT, created_at)`

Flow in `handleChat`:

1. Client sends `messages[]` (last 20 turns already on the client) + optional `session_id`.
2. `sanitizeMessages` clamps to `MAX_HISTORY=20`, `MAX_CONTENT=4000`, keeps only `user`/`assistant`.
3. If `session_id` is present → `ensureSession` upserts `chat_sessions`.
4. Worker starts the SSE stream from Workers AI, then `stream.tee()` — one half goes to client, the other is consumed in `waitUntil`-style async IIFE to aggregate the full assistant reply and `saveMessages(sessionId, userContent, assistantContent, sources)`.
5. `query_log` table records `(session_id, question, answer_len, sources_kb, sources_cat, model, latency_ms, error)` for ops.

Keep the teeing pattern — without it the request returns before the assistant text is known, so persistence is lost.

## RAG legs

Two parallel search legs, both computed on the **pure user question** (never on the assembled prompt, so attachment text does not poison the query):

### Leg 1 — catalog FTS
`searchCatalog(env, query, catalogTopK)`:
- builds an FTS5 query of prefix-quoted tokens: `"<tok>"*` joined by `OR` (max 5 tokens, length ≤ 120 chars).
- tries `catalog_fts MATCH ?` first (virtual table is **not** created by committed migrations — it is runtime-optional, so a fresh DB falls back).
- falls back to `SELECT * FROM catalog WHERE base_number LIKE ?`.

### Leg 2 — Vectorize KB
`searchKnowledge(env, query, vectorTopK)`:
- `env.AI.run('@cf/baai/bge-m3', { text: [query] })` → first vector (1024 dim).
- `env.VECTORIZE.query(vec, { topK, returnMetadata: 'all' })`.
- metadata expected: `{ title, content, source, kb_id, chunk }`.

Both legs use `Promise.all` so Vectorize latency does not stack on top of FTS. Either leg may be disabled by setting `catalog_topk` or `vector_topk` to `0` via `POST /api/settings` — the code uses `??` (not `||`) so `0` is respected.

## Prompt assembly

Order of blocks inside the final user message:

1. `Контекст:\n<catalog rows + kb snippets>` (from `buildContext`)
2. `Прикреплённые документы:\n<attachment_text>` (client-extracted PDF/DOCX/XLSX text, capped at `MAX_ATTACHMENT_TEXT = 12000`)
3. `Описание изображений:\n<vision descriptions>` (each image ≤ 1200 chars, ≤ 3 images)
4. `Вопрос: <user question>`

Final messages sent to the chat model:

```
[
  { role: 'system', content: <settings.system_prompt || AI_SYSTEM> },
  ...messages.slice(0, -1),        // prior turns verbatim
  { role: 'user', content: <assembled 4-block message> },
]
```

Temperature / max_tokens / topKs are read from the `settings` D1 table in a **single** query at the top of `handleChat` and null-coalesced against the defaults.

## Settings table

- Table: `settings (key PRIMARY KEY, value, updated_at)` — created lazily via `ensureSettingsTable`.
- Allowed keys (`SETTING_KEYS`): `system_prompt`, `temperature`, `max_tokens`, `catalog_topk`, `vector_topk`.
- `GET /api/settings` merges DB values over defaults and returns `_overrides` metadata for the admin UI.
- `POST /api/settings` (admin) batches writes: empty string → `DELETE` (clears override), non-empty → `INSERT … ON CONFLICT(key) DO UPDATE`.

## Knowledge base ingest

`POST /api/ingest` (admin):
1. Inserts row into `knowledge_base(category, title, content, keywords)`.
2. `chunkText(text, CHUNK_CHARS=1200, CHUNK_OVERLAP=150)` — tries to break at `. ` or `\n` in the last 40% of the chunk.
3. Batch-embeds chunks via `@cf/baai/bge-m3`.
4. Upserts vectors `kb-<kbId>-<i>` with metadata `{ title, content: chunk, source, category, kb_id, chunk }`.
5. Filters out embeddings whose length ≠ `EMBED_DIMS (1024)` so a degraded AI response never writes a bad vector.

## Reindex (re-embed existing KB)

`POST /api/reindex?after_id=N&chunk_from=M` is deliberately tiny per call (`REINDEX_CHUNKS_PER_CALL = 12`) because `bge-m3` on a 1200-char chunk is CPU-heavy. Client loops until response has `done: true`. Raising the constant causes `1102 CPU exceeded` on the largest KB rows (`knowledge_base.content` has a ~300k-char ceiling). Do not raise without benchmarking.
