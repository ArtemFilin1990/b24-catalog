# Миграции D1 для ai-kb

База данных: `baza` (id: `11a157a7-c3e0-4b6b-aa24-3026992db298`)

## Применить миграцию

### Продакшн (remote)
```bash
npx wrangler d1 execute baza --remote --file=migrations/0001_initial.sql
```

### Локально (dev)
```bash
npx wrangler d1 execute baza --local --file=migrations/0001_initial.sql
```

## Таблицы

| Таблица         | Назначение                                      |
|-----------------|-------------------------------------------------|
| `knowledge_base`| Документы базы знаний (ГОСТ, мануалы, договоры)|
| `kb_fts`        | FTS5-индекс для полнотекстового поиска по KB   |
| `chat_sessions` | Сессии чата (постоянная история)               |
| `chat_messages` | Сообщения — user / assistant                   |
| `query_log`     | Лог запросов к /api/ask (аналитика)            |

> Таблицы `catalog` и `imported_rows` создаются основным Worker'ом `b24-catalog`.
> В `ai-kb` они используются только на чтение (SELECT).
