# D1 Schema — ewerest-ai-chatbot

Полная схема БД `b24-catalog-db` (id `11a157a7-c3e0-4b6b-aa24-3026992db298`).
Применение миграции:
```bash
npx wrangler d1 execute b24-catalog-db --remote --file=scripts/d1_schema.sql
```

## Таблицы

### `chat_history` — память диалогов
| Поле        | Тип      | Назначение                            |
|-------------|----------|---------------------------------------|
| id          | INTEGER  | autoincrement                         |
| session_id  | TEXT     | UUID сессии клиента                   |
| role        | TEXT     | `user` / `assistant` / `system`       |
| content     | TEXT     | текст реплики                         |
| ts          | INTEGER  | unix ms                               |

Индексы: `(session_id, ts DESC)`, `(ts)`. TTL cleanup — cron `0 3 * * *` (30 дней).

### `documents` — метаданные базы знаний
| Поле         | Тип     | Назначение                                   |
|--------------|---------|----------------------------------------------|
| doc_id       | TEXT PK | UUID                                         |
| title        | TEXT    | отображаемое имя                             |
| category     | TEXT    | `gost` / `manual` / `docs` / `faq` / `other` |
| r2_key       | TEXT    | путь в R2 `vedro/docs/<id>.bin`              |
| filename     | TEXT    | исходное имя файла                           |
| size         | INTEGER | байт                                         |
| chunks       | INTEGER | число чанков в Vectorize                     |
| indexed      | INTEGER | 0/1                                          |
| uploaded_at  | INTEGER | unix ms                                      |
| indexed_at   | INTEGER | unix ms (null пока не проиндексирован)       |

Тело документа: R2 `docs/<doc_id>.bin` (оригинал) + `docs/<doc_id>.txt` (текстовая версия для ingest). PDF/DOCX парсить в браузере админки (как уже сделано в `ai-kb.35ewerest.workers.dev`) и класть `.txt` рядом.

### `catalog` — подшипники (1:1 с XLSX каталогом Эверест)
| Поле         | Тип     | Пример                       |
|--------------|---------|------------------------------|
| id           | INTEGER | autoincrement                |
| part_number  | TEXT    | `6205-2RS`                   |
| brand        | TEXT    | `SKF`                        |
| family       | TEXT    | `шариковый радиальный`       |
| name         | TEXT    | `Подшипник 6205-2RS SKF`     |
| d            | REAL    | `25`                         |
| D            | REAL    | `52`                         |
| H            | REAL    | `15`                         |
| mass         | REAL    | `0.13`                       |
| execution    | TEXT    | `2RS`                        |
| clearance    | TEXT    | `C3`                         |
| class        | TEXT    | `P0`                         |
| analog_gost  | TEXT    | `180205` или `NO DIRECT EQUIV` |
| analog_iso   | TEXT    | `6205-2RS`                   |
| price        | REAL    | (опционально)                |
| currency     | TEXT    | `RUB`                        |
| stock        | INTEGER | (опционально)                |
| image_url    | TEXT    | (опционально)                |
| updated_at   | INTEGER | unix ms                      |

Индексы: `UNIQUE(part_number)`, `(brand)`, `(d, D, H)` — критично для поиска аналогов, `(analog_gost)`, `(analog_iso)`.

Заливка: `python scripts/seed_catalog.py --xlsx catalog.xlsx --d1 b24-catalog-db --remote`.

### `config` — параметры бота
| Поле        | Тип     | Пример                                       |
|-------------|---------|----------------------------------------------|
| key         | TEXT PK | `temperature` / `system_prompt` / ...        |
| value       | TEXT    | `"0.3"` / JSON-строка                        |
| updated_at  | INTEGER | unix ms                                      |

Ключи: `temperature`, `max_tokens`, `catalog_top_k`, `kb_top_k`, `history_turns`, `system_prompt`, `chat_model`, `embedding_model`.

Правка: `PUT /admin/config/<key>` → `{"value": ...}`.

### `leads` — заявки из бота (опционально)
| Поле        | Тип     | Назначение                             |
|-------------|---------|----------------------------------------|
| id          | INTEGER | autoincrement                          |
| session_id  | TEXT    | связь с диалогом                       |
| name        | TEXT    |                                        |
| phone       | TEXT    |                                        |
| email       | TEXT    |                                        |
| company     | TEXT    |                                        |
| inn         | TEXT    | для DaData enrichment                  |
| request     | TEXT    | текст запроса                          |
| created_at  | INTEGER | unix ms                                |
| synced_b24  | INTEGER | 0/1 — создан лид в Bitrix24            |

Cron-синк в Bitrix24 через `env.BITRIX24_WEBHOOK` (не в этом skill — см. `b24-everest-bearings`).

## Миграции

Принцип: **только `ALTER TABLE ADD COLUMN`** или новые таблицы. Не дропать, не переименовывать.
Новые миграции класть в `scripts/migrations/NNNN_name.sql`, применять:
```bash
npx wrangler d1 migrations apply b24-catalog-db --remote
```

## Типовые запросы

```sql
-- Активные сессии за сутки
SELECT COUNT(DISTINCT session_id) FROM chat_history
WHERE ts > strftime('%s','now','-1 day') * 1000;

-- Топ-10 последних запросов
SELECT content, ts FROM chat_history
WHERE role='user' ORDER BY ts DESC LIMIT 10;

-- Поиск подшипника по геометрии
SELECT part_number, brand, execution FROM catalog
WHERE d=25 AND D=52 AND H=15;

-- Неиндексированные документы
SELECT doc_id, title FROM documents WHERE indexed=0;
```
