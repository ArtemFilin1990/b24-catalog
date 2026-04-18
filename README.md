# Каталог подшипников

Cloudflare Worker с D1 базой и R2 бакетом для B2B-каталога ООО «Эверест».

## Архитектура

- **Worker** `b24-catalog` — отдаёт HTML каталога и обрабатывает API.
- **Assets** в `public/` — `index.html` (каталог).
- **D1 база** `baza` (id: `11a157a7-c3e0-4b6b-aa24-3026992db298`) — импорты и заявки.
- **R2 бакет** `vedro` (binding `CATALOG`) — `catalog.gz` с данными каталога и ежедневные бэкапы D1.
- **Cron** `0 3 * * *` — ежедневный бэкап таблиц D1 в R2 (`backups/d1-backup-*.json` + `backups/latest.json`).

## API endpoints

| Путь | Метод | Что делает |
|---|---|---|
| `/` | GET | Каталог (HTML из `public/index.html`) |
| `/app` | GET | Алиас для `/` |
| `/catalog.gz` | GET | `catalog.gz` из R2 (данные каталога) |
| `/api/ping` | GET | Healthcheck |
| `/api/ask` | GET/POST | AI-консультация (Workers AI + D1) |
| `/api/imports` | GET | Все активные импорты |
| `/api/imports` | POST | Сохранить пакет строк |
| `/api/imports/:session_id` | DELETE | Пометить сессию удалённой (soft delete) |
| `/api/sessions` | GET | Список сессий импорта |
| `/api/orders` | POST | Создать заявку (сохраняется в D1) |
| `/api/orders` | GET | Список заявок |
| `/api/backup` | POST | Ручной бэкап D1 → R2 |
| `/api/admin/upload-catalog` | POST | Загрузка `catalog.gz` в R2 (нужен заголовок `x-upload-token`) |

## D1 таблицы

- `imported_rows` — импортированные позиции (флаг `deleted` для soft delete).
- `import_sessions` — сессии загрузки (файл, формат, автор, статус).
- `orders` — заявки клиентов.
