# b24-catalog — Каталог подшипников

Cloudflare Worker с D1 базой и R2 бакетом для B2B-каталога ООО «Эверест».

## Архитектура

- **Worker** `b24-catalog` — отдаёт HTML каталога и обрабатывает API.
- **Assets** в `public/` — `index.html` (каталог) и `install.html` (служебная страница установки).
- **D1 база** `baza` (id: `11a157a7-c3e0-4b6b-aa24-3026992db298`) — импорты и заявки.
- **R2 бакет** `vedro` (binding `CATALOG`) — `catalog.gz` с данными каталога и ежедневные бэкапы D1.
- **Cron** `0 3 * * *` — ежедневный бэкап таблиц D1 в R2 (`backups/d1-backup-*.json` + `backups/latest.json`).

## API endpoints

| Путь | Метод | Что делает |
|---|---|---|
| `/` | GET | Каталог (HTML из `public/index.html`) |
| `/` | POST | Отдаёт `install.html` |
| `/app` | GET / POST | Алиас для `/` |
| `/install` | GET / POST | Отдаёт `install.html` |
| `/catalog.gz` | GET | `catalog.gz` из R2 (данные каталога) |
| `/api/ping` | GET | Healthcheck |
| `/api/imports` | GET | Все активные импорты |
| `/api/imports` | POST | Сохранить пакет строк |
| `/api/imports/:session_id` | DELETE | Пометить сессию удалённой (soft delete) |
| `/api/sessions` | GET | Список сессий импорта |
| `/api/orders` | POST | Создать заявку |
| `/api/orders` | GET | Список заявок |
| `/api/backup` | POST | Ручной бэкап D1 → R2 |
| `/api/admin/upload-catalog` | POST | Загрузка `catalog.gz` в R2 (нужен заголовок `x-upload-token`) |

Все ответы ассетов оборачиваются заголовками CSP и CORS.

## D1 таблицы

- `imported_rows` — импортированные позиции (флаг `deleted` для soft delete).
- `import_sessions` — сессии загрузки (файл, формат, автор, статус).
- `orders` — заявки.

## Подключение и окружение Cloudflare

Перед деплоем/миграциями подключите `wrangler` к аккаунту Cloudflare:

```bash
npx wrangler login
npx wrangler whoami
```

Проверьте, что доступны ресурсы из `wrangler.toml` (`baza`, `vedro`):

```bash
npx wrangler d1 list
npx wrangler r2 bucket list
```

### Обязательные секреты Worker

В Worker используются секреты окружения:

- `UPLOAD_TOKEN` — токен для `POST /api/admin/upload-catalog` (заголовок `x-upload-token`).

Для локальной разработки создайте `.dev.vars` из шаблона:

```bash
cp .dev.vars.example .dev.vars
```

Задать секреты:

```bash
npx wrangler secret put UPLOAD_TOKEN
```

После настройки окружения можно выполнять деплой:

```bash
npx wrangler deploy
```
