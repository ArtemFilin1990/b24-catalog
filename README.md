# B2B-каталог подшипников + AI-ассистент «Бот Эверест»

Cloudflare mono-repo с **двумя Workers**, общей D1-базой и R2-бакетом для B2B-каталога ООО «Эверест».

## Архитектура

| Worker | Директория | Прод URL | Назначение |
|---|---|---|---|
| `b24-catalog` | `./src`, `./public`, `./wrangler.toml` | `b24-catalog.35ewerest.workers.dev` | Каталог подшипников: HTML, API импортов/заявок, `catalog.gz` из R2, AI-консультация, D1→R2 бэкап по cron |
| `ai-kb` | `./ai-kb` | `ai-kb.35ewerest.workers.dev` | «Бот Эверест»: SSE-чат с RAG (D1 FTS + Vectorize), редактируемый системный промпт, вложения + vision, загрузка файлов в базу знаний, история сессий |

Общие биндинги:

- **D1** `baza` (id: `11a157a7-c3e0-4b6b-aa24-3026992db298`) — импорты, заявки, каталог, чат-сессии, база знаний.
- **R2** `vedro` (binding `CATALOG`) — `catalog.gz`, бэкапы D1, загруженные файлы.
- **Workers AI** — `llama-3.3-70b-instruct-fp8-fast` (чат), `llama-3.2-11b-vision-instruct` (изображения), `bge-m3` (эмбеддинги).
- **Vectorize** `ai-kb-index` (1024 dim, cosine) — семантический поиск по базе знаний.
- **Cron** `0 3 * * *` — ежедневный бэкап D1 → R2.

## Структура репо

```
├── src/                     # Исходники b24-catalog worker
│   ├── index.js             # Роутер + бизнес-логика
│   └── ratelimit.js         # Rate limiting
├── public/                  # Статика b24-catalog (каталог HTML)
├── migrations/              # D1 миграции (root worker)
│   ├── 0001_root_schema.sql
│   └── 0002_rate_limit.sql
├── ai-kb/                   # AI-ассистент (отдельный worker)
│   ├── src/                 # Исходники ai-kb worker
│   │   ├── index.js         # Роутер + чат + RAG + настройки
│   │   ├── files.js         # Загрузка/управление файлами
│   │   └── ratelimit.js     # Rate limiting
│   ├── public/              # UI чат-бота
│   ├── migrations/          # D1 миграции (ai-kb)
│   ├── sql/                 # SQL-шаблоны для пайплайна импорта каталога
│   └── wrangler.toml
├── data/                    # Генерация catalog.gz из XLSX
├── docs/RUNBOOK.md          # Операционный рунбук
├── skill-packs/             # Донорские материалы (только для справки)
├── .github/workflows/       # CI/CD
│   ├── deploy.yml           # Деплой b24-catalog (CF Git integration + R2 upload)
│   └── deploy-ai-kb.yml    # Деплой ai-kb (GHA only, retry loop)
├── wrangler.toml            # Конфиг b24-catalog worker
└── CLAUDE.md                # Контекст для AI-агентов
```

## API endpoints

### b24-catalog (`b24-catalog.35ewerest.workers.dev`)

| Путь | Метод | Доступ | Что делает |
|---|---|---|---|
| `/` | GET | public | Каталог (HTML) |
| `/app` | GET | public | Алиас для `/` |
| `/catalog.gz` | GET | public | Данные каталога из R2 |
| `/api/ping` | GET | public | Healthcheck |
| `/api/ask` | GET/POST | public | AI-консультация (Workers AI + D1) |
| `/api/imports` | GET | public | Активные импорты (лента каталога) |
| `/api/imports` | POST | admin | Сохранить пакет строк |
| `/api/imports/:id` | DELETE | admin | Soft delete сессии импорта |
| `/api/sessions` | GET | admin | Список сессий импорта |
| `/api/orders` | POST | public | Создать заявку |
| `/api/orders` | GET | admin | Список заявок |
| `/api/backup` | POST | admin | Ручной бэкап D1 → R2 |
| `/api/admin/upload-catalog` | POST | upload | Загрузка `catalog.gz` в R2 |
| `/api/admin/audit` | GET | admin | Аудит-лог привилегированных операций |

### ai-kb (`ai-kb.35ewerest.workers.dev`)

| Путь | Метод | Доступ | Что делает |
|---|---|---|---|
| `/` | GET | public | UI чат-бота |
| `/api/health` | GET | public | Healthcheck (модель, статус) |
| `/api/chat` | POST | public | SSE-стрим чата с RAG |
| `/api/stats` | GET | public | Статистика базы знаний |
| `/api/settings` | GET/POST | admin | Чтение/обновление настроек (промпт, температура, top-K) |
| `/api/sessions` | GET | admin | История чат-сессий |
| `/api/sessions/:id` | DELETE | admin | Удалить сессию |
| `/api/ingest` | POST | admin | Загрузка контента в базу знаний |
| `/api/reindex` | POST | admin | Переиндексация Vectorize |
| `/api/admin/files/*` | * | admin | Управление загруженными файлами |

**admin** = `X-Admin-Token` header (секрет `ADMIN_TOKEN` в Cloudflare).

## D1 миграции

Применение в порядке (идемпотентно):

```bash
# Root worker
npx wrangler d1 execute baza --remote --file=migrations/0001_root_schema.sql
npx wrangler d1 execute baza --remote --file=migrations/0002_rate_limit.sql

# ai-kb worker
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0001_initial.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0002_files_rules_catalog.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0003_catalog_staging.sql
npx wrangler d1 execute baza --remote --file=ai-kb/migrations/0004_catalog_master_view.sql
```

## Деплой

| Worker | Триггер | Способ |
|---|---|---|
| `b24-catalog` | Push в `main` | Cloudflare native Git integration + GHA (`deploy.yml`) для загрузки `catalog.gz` в R2 |
| `ai-kb` | Push в `main` + cron `*/15 * * * *` | **Только** GHA (`deploy-ai-kb.yml`) с retry loop (до 6 попыток) |

> ⚠️ Нативный CF Git build для `ai-kb` **отключён** — он перетирает worker кодом root-каталога. Подробности в `docs/RUNBOOK.md`.

## Секреты

Все секреты — только в Cloudflare, **никогда** в коде:

```bash
# b24-catalog
echo "$TOKEN" | npx wrangler secret put ADMIN_TOKEN
echo "$TOKEN" | npx wrangler secret put ADMIN_UPLOAD_TOKEN

# ai-kb
cd ai-kb && echo "$TOKEN" | npx wrangler secret put ADMIN_TOKEN
```

## Smoke-тесты

```bash
# b24-catalog
curl -s https://b24-catalog.35ewerest.workers.dev/api/ping

# ai-kb
curl -s https://ai-kb.35ewerest.workers.dev/api/health
```

## Документация

- `docs/RUNBOOK.md` — полный операционный рунбук (секреты, восстановление, аудит, бэклог)
- `CLAUDE.md` — контекст для AI-агентов (архитектура, конвенции, ограничения)
