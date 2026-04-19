-- ============================================================
-- Миграция 0002: rate limiting (fixed-window)
-- Workers: b24-catalog + ai-kb | D1: baza
--
-- Таблица считает запросы на эндпоинт в окне размером window_sec.
-- Ключ строки — bucket (обычно "<endpoint>:<ip>") + window_start
-- (unixepoch() // window_sec * window_sec).
--
-- UPSERT atomic: 1 роундтрип на запрос вместо SELECT+INSERT/UPDATE.
-- При перезапуске окна (новый window_start) — новая строка с count=1.
-- Старые строки подметает cron (см. §cleanup в docs/RUNBOOK.md).
--
-- Применение:
--   wrangler d1 execute baza --remote --file=migrations/0002_rate_limit.sql
-- Миграция идемпотентна.
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limit (
  bucket        TEXT    NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- Индекс для чистки старых окон (DELETE WHERE window_start < ?).
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit (window_start);

-- Ensure the schema_migrations tracker exists even if 0001_root_schema
-- hasn't been applied on this D1. Idempotent.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT    PRIMARY KEY,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0002_rate_limit');
