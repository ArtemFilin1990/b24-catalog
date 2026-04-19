# b24-catalog / ai-kb — Production Runbook

Этот документ — операционная шпаргалка для двух Cloudflare Workers:

| Worker | Каталог | URL | Роль |
|---|---|---|---|
| `b24-catalog` | `./src` + `./public` | `https://b24-catalog.35ewerest.workers.dev` | Каталог, импорты, заявки, `catalog.gz` |
| `ai-kb` | `./ai-kb` | `https://ai-kb.35ewerest.workers.dev` | AI-ассистент (чат, RAG, настройки, база знаний) |

Общие биндинги: D1 `baza`, R2 `vedro`, Vectorize `ai-kb-index`, Workers AI.

---

## 1. Секреты

Все секреты живут **только** в Cloudflare — не в коде, не в репо, не в `wrangler.toml`.
Обновление делается через `wrangler secret put`:

```bash
# b24-catalog (root)
wrangler secret put ADMIN_TOKEN                    # общий админский токен
wrangler secret put ADMIN_UPLOAD_TOKEN             # старый X-Upload-Token для /api/admin/upload-catalog
# ai-kb
cd ai-kb
wrangler secret put ADMIN_TOKEN
```

### Ротация скомпрометированного токена

Если токен утёк в git history / чат / скриншот:

```bash
# 1. Сразу выставить новый в проде:
echo "NEW_STRONG_TOKEN" | wrangler secret put ADMIN_TOKEN

# 2. Обновить GitHub Actions secret CF_API_TOKEN (если нужен именно CF API):
#    Settings → Secrets and variables → Actions → CF_API_TOKEN

# 3. Ротировать сам CF API Token в https://dash.cloudflare.com/profile/api-tokens
#    — Revoke старый, Create новый с правами Workers Scripts:Edit,
#    Workers AI:Edit, D1:Edit, R2:Edit, Vectorize:Edit.

# 4. Проверить деплой:
curl -X POST https://ai-kb.35ewerest.workers.dev/api/settings \
  -H "Content-Type: application/json" -H "X-Admin-Token: NEW_STRONG_TOKEN" \
  -d '{"settings":{"temperature":""}}'
# → {"ok":true,...}
```

### Известные утечки (нужно ротировать)

- Старый захардкоженный `X-Upload-Token` (префикс `045IUU…`, удалён в этой PR) **всё ещё присутствует в git history** — ротировать обязательно. Полное значение не тиражируем здесь, см. коммит `9dbc82a9` в git log. Новый секрет установить: `openssl rand -hex 32 | wrangler secret put ADMIN_UPLOAD_TOKEN`.
- Слабый `ADMIN_TOKEN` для ai-kb (короткий, из ранних тестов) — заменить: `openssl rand -hex 32 | (cd ai-kb && wrangler secret put ADMIN_TOKEN)`.
- Любые `cfat_*` CF API-токены, попавшие в переписку/скриншоты — отозвать в https://dash.cloudflare.com/profile/api-tokens.

---

## 2. Миграции D1

### Первая синхронизация существующей базы

```bash
# root worker
wrangler d1 execute baza --remote --file=migrations/0001_root_schema.sql

# ai-kb worker
cd ai-kb
wrangler d1 execute baza --remote --file=migrations/0001_initial.sql
```

Миграции идемпотентны (`CREATE ... IF NOT EXISTS`), индексы добавятся без потери данных. Таблица `schema_migrations` отслеживает применённые версии.

### Проверка состояния

```bash
wrangler d1 execute baza --remote --command "SELECT * FROM schema_migrations"
wrangler d1 execute baza --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
```

---

## 3. Деплой

| Worker | Источник | Способ |
|---|---|---|
| `b24-catalog` | `main` (push) | Cloudflare native Git integration (dashboard) |
| `ai-kb`       | `main` (push) | **Только** GitHub Actions `.github/workflows/deploy-ai-kb.yml` |

Нативный CF Git build для `ai-kb` **отключён** (DELETE `/workers/services/ai-kb/environments/production/build-trigger`), чтобы он не перетирал правильную сборку из `ai-kb/`. Если снова появится — сразу удалить тем же способом.

GHA workflow запускается:
- на любой push в `main`
- по cron `*/15 * * * *` (самовосстановление если воркер был перезаписан)
- вручную через **Run workflow**

Деплой делает до 6 попыток `wrangler deploy` + smoke-check (`<title>Бот Эверест</title>` и `/api/health`). Пинится `wrangler@4.83.0`.

### Ручной деплой

```bash
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=84cbacc4816c29c294101ec57a0bea5d

# root
wrangler deploy

# ai-kb
cd ai-kb
wrangler deploy
```

---

## 4. Smoke-тесты

```bash
# Root worker
curl -s https://b24-catalog.35ewerest.workers.dev/api/ping
curl -s -X POST https://b24-catalog.35ewerest.workers.dev/api/backup \
  -H "X-Admin-Token: $ADMIN_TOKEN"          # без токена → 401
curl -s https://b24-catalog.35ewerest.workers.dev/api/orders \
  -H "X-Admin-Token: $ADMIN_TOKEN"          # список заявок

# ai-kb
curl -s https://ai-kb.35ewerest.workers.dev/api/health
curl -s https://ai-kb.35ewerest.workers.dev/api/stats
curl -sN -X POST https://ai-kb.35ewerest.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"аналог 6205"}]}'
curl -s -X POST https://ai-kb.35ewerest.workers.dev/api/settings \
  -H "Content-Type: application/json" -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"settings":{"temperature":"0.25"}}'
```

---

## 5. Аудит-лог

Каждая привилегированная операция пишется в D1-таблицу `admin_audit_log`:

| Action | Ресурс | Оператор |
|---|---|---|
| `backup` | `d1->r2` | POST /api/backup |
| `orders.list` | — | GET /api/orders |
| `imports.soft_delete` | session_id | DELETE /api/imports/:id |
| `r2.upload` | `catalog.gz` | POST /api/admin/upload-catalog |

Просмотр:

```bash
curl -s https://b24-catalog.35ewerest.workers.dev/api/admin/audit \
  -H "X-Admin-Token: $ADMIN_TOKEN" | jq
```

---

## 6. Восстановление

### Из бэкапа D1

Root-воркер кладёт в R2 `vedro/backups/latest.json` дамп `imported_rows` + `import_sessions` + `orders`. Восстановление — вручную через скрипт + `wrangler d1 execute`.

### При зачистке/поломке ai-kb воркера

```bash
# Пересоздать воркер и биндинги:
cd ai-kb
wrangler deploy

# Пересоздать секрет:
echo "$ADMIN_TOKEN" | wrangler secret put ADMIN_TOKEN

# Переиндексировать базу знаний (если Vectorize пустой):
curl -X POST "https://ai-kb.35ewerest.workers.dev/api/reindex?after_id=0&chunk_from=0" \
  -H "X-Admin-Token: $ADMIN_TOKEN"
# (повторять в цикле пока {"done":true})
```

---

## 7. Оставшийся долг (follow-up PRs)

Эта PR закрыла P0-security. Следующие циклы:

**P1 — infrastructure:**
- Rate limit на `/api/chat`, `/api/ask`, `/api/orders POST` (D1-backed sliding window).
- Миграция `0002_production_hardening.sql` с таблицами `files`, `file_chunks`, `media_assets`, `jobs`, `cleanup_log`.
- Cloudflare Queues: producer в ingest/reindex, consumer-воркер.
- Серверное извлечение PDF/DOCX/XLSX (SheetJS работает в Workers; pdfjs-dist — под вопросом, нужен бенчмарк CPU).
- R2-хранилище для картинок/аудио + метаданные в D1.
- Whisper endpoint `POST /api/admin/audio/transcribe` (`@cf/openai/whisper`).
- Cron-воркер: orphan cleanup в R2, прореживание `query_log`, удаление старых `chat_sessions`.

**P2 — observability:**
- CORS с whitelist origins (сейчас `*`).
- Структурированное логирование + request-ID.
- Снижение `observability.head_sampling_rate` с 1.0 → 0.1 в проде.
- ETag для `catalog.gz`.
- AbortSignal на долгих SSE-стримах.

---

## 8. Контакты

- Cloudflare account: `84cbacc4816c29c294101ec57a0bea5d`
- Vectorize index: `ai-kb-index` (1024 dim, cosine)
- D1: `baza` (shared between root and ai-kb)
- R2: `vedro`
