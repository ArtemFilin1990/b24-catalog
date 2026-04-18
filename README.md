# Каталог подшипников

B2B-каталог подшипников для ООО «Эверест» / ТД «Эверест» (Вологда). Два независимых Cloudflare Workers в одном репозитории, работающих с общей D1-базой и R2-бакетом.

## Структура проекта

```
b24-catalog/          # Основной Worker: каталог + API импортов/заявок
ai-kb/                # AI-воркер: чат-консультант с памятью сессий
data/                 # Источники данных (XLSX, catalog.gz, скрипт генерации)
public/               # Статика основного воркера (SPA каталога)
```

## Workers

### b24-catalog (корень репозитория)

Отдаёт HTML каталога, обрабатывает API импортов и заявок, запускает ежедневный бэкап D1 → R2.

**Ресурсы:**
- Assets в `public/` — `index.html` (SPA каталога)
- D1 база `baza` — импорты, сессии, заявки
- R2 бакет `vedro` — `catalog.gz` и бэкапы (`backups/`)
- Cron `0 3 * * *` — ежедневный бэкап D1 → R2

**API endpoints:**

| Путь | Метод | Что делает |
|---|---|---|
| `/`, `/app` | GET | Каталог (HTML) |
| `/catalog.gz` | GET | `catalog.gz` из R2 |
| `/api/ping` | GET | Healthcheck |
| `/api/ask` | GET/POST | AI-консультация (Workers AI + D1) |
| `/api/imports` | GET | Все активные импорты |
| `/api/imports` | POST | Сохранить пакет строк |
| `/api/imports/:session_id` | DELETE | Soft-delete сессии (`deleted = 1`) |
| `/api/sessions` | GET | Список сессий импорта |
| `/api/orders` | GET/POST | Список / создание заявки |
| `/api/backup` | POST | Ручной бэкап D1 → R2 |
| `/api/admin/upload-catalog` | POST | Загрузка `catalog.gz` в R2 (заголовок `x-upload-token`) |

### ai-kb (`ai-kb/`)

Самостоятельный AI-чат с памятью переписки на сессию. Подробнее — в [`ai-kb/README.md`](ai-kb/README.md).

**API endpoints:**

| Путь | Метод | Что делает |
|---|---|---|
| `/api/ping` | GET | Healthcheck |
| `/api/ask` | GET/POST | Вопрос AI (опциональный `session_id` для памяти) |
| `/api/history/:session_id` | GET | История переписки сессии |
| `/api/history/:session_id` | DELETE | Очистить память сессии |

## D1 таблицы

- `catalog` — каталог подшипников (только чтение, предзаполнена).
- `imported_rows` — импортированные позиции (флаг `deleted` для soft delete).
- `import_sessions` — сессии загрузки (файл, формат, автор, статус).
- `orders` — заявки клиентов.
- `chat_memory` — история переписки AI-чата (ai-kb).

## Данные каталога

Источник данных — `data/ewerest_bearing_catalog_filled_all.xlsx`. Для пересборки каталога:

```bash
python data/gen_catalog.py   # → data/catalog.gz
```

`catalog.gz` коммитится в репозиторий; при деплое `deploy.yml` загружает его в R2 (`vedro/catalog.gz`).

## Деплой

Автоматически при пуше в `main`:
- Корневые изменения → `.github/workflows/deploy.yml` (загружает `catalog.gz`, деплоит `b24-catalog`)
- Изменения в `ai-kb/**` → `.github/workflows/deploy-ai-kb.yml` (деплоит `ai-kb`)

Требуется секрет `CF_API_TOKEN`.

Ручной деплой:
```bash
npx wrangler deploy          # b24-catalog
cd ai-kb && npx wrangler deploy  # ai-kb
```
