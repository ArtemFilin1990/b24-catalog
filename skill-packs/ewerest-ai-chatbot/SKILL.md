---
name: ewerest-ai-chatbot
description: >-
  Production Cloudflare Workers AI chatbot for ООО «Эверест» (B2B bearings, ewerest.ru) with
  conversation memory (D1), RAG over knowledge base (Vectorize + R2), bearing identification,
  ГОСТ⇄ISO analog lookup, and admin panel. Use whenever the user asks to create, deploy, fix,
  extend, or audit a Cloudflare Workers AI chatbot for Everest / bearings / ai-kb.35ewerest.workers.dev
  / b24-catalog. Also trigger on: создай бота на Workers AI, чат-бот Эверест, RAG бот подшипники,
  бот с памятью D1, векторный поиск Vectorize, база знаний R2, подбор аналогов в боте,
  ai-kb bot, Workers AI chatbot, Cloudflare AI bot with memory, deploy CF AI bot, системный
  промпт для бота подшипников, admin panel for Workers AI bot.
---

# Эверест AI Chatbot (Cloudflare Workers)

Production-ready RAG-чатбот для B2B каталога подшипников. Разворачивается одной командой на
аккаунте `84cbacc4816c29c294101ec57a0bea5d`, использует Workers AI + D1 + Vectorize + R2.

## Когда использовать

Триггеры:
- «создай/обнови/почини бота на Workers AI для Эверест»
- «добавь память в бота ai-kb»
- «подключи векторный поиск по каталогу подшипников»
- «бот должен понимать ГОСТ и подбирать аналоги»
- «залей базу знаний в R2 + Vectorize»
- «сделай админку для правки промпта/параметров»
- работа с репо `ArtemFilin1990/b24-catalog` по теме бота

## Архитектура

```
[User] ──HTTP──▶ [Worker: /chat]
                    │
                    ├─▶ D1: chat_history(session_id, role, content, ts)  ← память диалога
                    ├─▶ Vectorize: query(embedding)                       ← top-K чанков KB
                    ├─▶ R2: get(doc_id)                                   ← полные документы
                    ├─▶ D1: catalog(part_number, d, D, H, brand, ...)     ← подшипники
                    └─▶ AI: llama-3.3-70b (chat completion с контекстом)
                                  │
                                  ▼
                        Ответ + источники
```

Bindings (см. `references/wrangler-template.toml`):
- `AI`            — Workers AI
- `DB`            — D1 (`11a157a7-c3e0-4b6b-aa24-3026992db298`)
- `KB_INDEX`      — Vectorize index (embeddings KB)
- `CATALOG_INDEX` — Vectorize index (embeddings каталога, опционально)
- `R2`            — R2 bucket `vedro`
- `ASSETS`        — static admin UI

## Быстрый старт

1. `cp references/wrangler-template.toml wrangler.toml` — заполни IDs.
2. `bash scripts/deploy.sh` — создаст Vectorize-индексы (если нет), применит D1-миграции, задеплоит Worker.
3. `scripts/seed_catalog.py --xlsx catalog.xlsx` — заливка каталога в D1.
4. Зайти на `https://<worker>.workers.dev/admin` → правка system prompt, загрузка документов в KB.
5. Проверить `/chat` POST `{session_id, message}` → ответ с источниками.

## Модули (см. `src/`)

| Файл            | Ответственность                                                      |
|-----------------|----------------------------------------------------------------------|
| `index.js`      | Router `/chat`, `/admin/*`, `/upload`, `/ingest`                     |
| `memory.js`     | D1 история: `saveTurn`, `loadHistory(session, limit=10)`             |
| `rag.js`        | Embedding → Vectorize query → R2 fetch чанков → форматирование       |
| `bearings.js`   | `normalize(part)`, `findAnalog(gost|iso)` с правилом NO DIRECT EQUIV |
| `prompt.js`     | Сборка system prompt + context + history                             |
| `admin.js`      | GET/PUT system_prompt, params (temp, max_tokens, top-K)              |

## Правила для подшипников (обязательно)

Бот ОБЯЗАН в ответах:
- отделять базовый номер от префиксов/суффиксов (2RS, ZZ, C3, K, N, NR, P6, P5, P4, M, TN, E)
- аналог ГОСТ⇄ISO только при совпадении type + series + d/D/B + execution
- если полного совпадения нет — писать `NO DIRECT EQUIV`
- непроверенные данные — `[[TBD]]` + где проверить
- формат карточки: идентификация → изображение → параметры → аналоги → контакты

Логика в `src/bearings.js`. System prompt в `references/system-prompt.md`.

## Память диалога

- Ключ: `session_id` (клиент передаёт в заголовке или body).
- Хранится в D1 `chat_history` (до 10 последних реплик по сессии).
- На каждый запрос: подгружается история + последние N сообщений вшиваются в промпт.
- TTL: 30 дней (cron в `scripts/cleanup.sql`).

## RAG pipeline

1. `POST /upload` — файл (PDF/DOCX/TXT) → R2 `vedro/docs/<doc_id>`.
2. `/ingest?doc_id=...` — парсинг → чанки по ~500 токенов → embedding (`@cf/baai/bge-base-en-v1.5` или мультиязычная модель) → upsert в Vectorize.
3. На `/chat`:
   - embed(user message)
   - `KB_INDEX.query(vector, topK=5)`
   - для каждого match: R2.get(metadata.doc_id, metadata.chunk_id) → текст
   - конкатенация в `CONTEXT` блок системного промпта

## Инструкции для Claude (пошагово)

### Режим A: «создай бота с нуля»
1. Проверь `wrangler.toml` в репо — есть ли уже bindings.
2. Скопируй `src/*` в репо (в `src/`).
3. Скопируй `references/wrangler-template.toml` → `wrangler.toml`, заполни IDs.
4. Запусти `scripts/deploy.sh`.
5. Проверь `/chat` curl-ом.

### Режим B: «добавь память/RAG в существующий бот»
1. Прочитай текущий `src/index.js` через `Read`.
2. Сравни с `src/` в скилле — найди missing модули.
3. Добавь только то, чего нет (`memory.js`, `rag.js`).
4. Обнови `index.js` чтобы вызывал их в `/chat`.
5. Применить D1-миграции `scripts/d1_schema.sql`.

### Режим C: «почини/улучшень ответы по подшипникам»
1. Проверь `references/system-prompt.md` — актуален ли.
2. Проверь `src/bearings.js` — правило NO DIRECT EQUIV на месте.
3. Если не отделяет префиксы — усили регулярку в `normalize()`.
4. Добавить few-shot примеры в system prompt при необходимости.

### Режим D: «залей каталог/документы»
1. Каталог: `python scripts/seed_catalog.py --xlsx <path>` (читает 79 строк, 5 семейств SKF/ГПЗ/FAG/ZWZ).
2. Документы: `POST /upload` multipart → `POST /ingest?doc_id=<id>`.
3. Проверить `KB_INDEX.describe()` — количество векторов выросло.

### Режим E: «аудит бота»
Проверить:
- [ ] D1 schema применена (`chat_history`, `catalog`, `config`)
- [ ] Vectorize index создан и не пустой
- [ ] R2 bucket доступен
- [ ] `/admin` требует токен (ADMIN_TOKEN secret)
- [ ] System prompt содержит правила подшипников
- [ ] `/chat` принимает session_id
- [ ] История обрезается до 10 реплик
- [ ] Источники (doc_id, chunk_id) возвращаются в ответе

## Модели (Workers AI)

| Задача    | Модель                                | Примечание                         |
|-----------|---------------------------------------|------------------------------------|
| Chat      | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | качество/скорость                  |
| Chat-alt  | `@cf/qwen/qwen2.5-coder-32b-instruct` | для кода/JSON режима               |
| Embedding | `@cf/baai/bge-m3`                     | мультиязычная (RU+EN), 1024 dim    |
| Re-rank   | `@cf/baai/bge-reranker-base`          | опционально после Vectorize        |

## Параметры по умолчанию

```json
{
  "temperature": 0.3,
  "max_tokens": 1024,
  "catalog_top_k": 5,
  "kb_top_k": 5,
  "history_turns": 10,
  "embedding_model": "@cf/baai/bge-m3",
  "chat_model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
}
```

Хранится в D1 `config` (key/value). Правится через `/admin`.

## Секреты (wrangler secret)

```
ADMIN_TOKEN       # bearer для /admin/*
TELEGRAM_TOKEN    # опционально — пуш уведомлений о лидах
BITRIX24_WEBHOOK  # опционально — создание лида в CRM
```

## Валидация

Перед деплоем:
```bash
npx wrangler deploy --dry-run
bash scripts/smoke_test.sh  # curl /chat, /admin, /upload
```

## Границы skill

НЕ использовать для:
- ботов не-Эверест (общий Workers AI туториал → `CF Workers AI docs`)
- Telegram-ботов (→ `telegram-everest-bots` skill)
- Bitrix24-чат-ботов (→ `b24-everest-bearings` skill)

## См. также

- `AGENT.md` — routing between modes
- `references/bearing-rules.md` — строгие правила ГОСТ⇄ISO
- `references/system-prompt.md` — эталонный system prompt
- `references/wrangler-template.toml` — шаблон конфига
- `references/d1-schema.md` — полная схема БД
