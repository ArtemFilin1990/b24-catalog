# ai-kb — AI-консультант ТД «Эверест»

Самостоятельный Cloudflare Worker — чат-бот на базе Llama 3.1 (Workers AI) с памятью переписки на сессию (D1).

## Архитектура

- **Модель:** `@cf/meta/llama-3.1-8b-instruct` через AI Gateway (`catalog`, 1 ч. кэш)
- **Память:** D1 таблица `chat_memory` — хранит историю диалога по `session_id`
- **База знаний:** поиск по таблицам `catalog` и `imported_rows` (та же D1 база `baza`)
- **Стиль кода:** `src/index.js` намеренно минифицирован вручную — не переформатировать

## API

| Путь | Метод | Описание |
|---|---|---|
| `/api/ping` | GET | Healthcheck |
| `/api/ask` | GET | Вопрос через `?q=...&session_id=...` |
| `/api/ask` | POST | `{"question":"...", "session_id":"..."}` |
| `/api/history/:session_id` | GET | История переписки (до 200 сообщений) |
| `/api/history/:session_id` | DELETE | Очистить память сессии |

`session_id` — произвольная строка (UUID или любой идентификатор клиента). Если не передан — ответ без сохранения в памяти.

## Деплой

Входит в общий репозиторий `b24-catalog`. Деплоится отдельным workflow при изменениях в `ai-kb/**`:

```bash
cd ai-kb && npx wrangler deploy
```

Требуется секрет `CF_API_TOKEN` (аккаунт `84cbacc4816c29c294101ec57a0bea5d`).

## Локальный запуск

```bash
cd ai-kb && npx wrangler dev
```

Требуется Wrangler CLI и доступ к Cloudflare (D1 и AI binding работают только в remote-режиме или с `--remote`).
