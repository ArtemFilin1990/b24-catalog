-- ============================================================
-- Миграция 0005: settings (KV-overrides для ai-kb runtime)
-- Worker: ai-kb | D1: baza
--
-- Раньше таблица создавалась лениво из ai-kb/src/index.js
-- (`ensureSettingsTable`) — DDL дёргался на каждый GET/POST /api/settings
-- и на каждый /api/chat. Эта миграция фиксирует схему как канон;
-- runtime теперь только читает/пишет через INSERT … ON CONFLICT.
--
-- Применение:
--   wrangler d1 execute baza --remote --file=ai-kb/migrations/0005_settings.sql
-- Идемпотентна.
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Дефолты — INSERT OR IGNORE не трогает существующие override'ы оператора.
-- Это подмножество SETTING_KEYS из ai-kb/src/index.js: numeric runtime
-- параметры. Ключ system_prompt здесь намеренно НЕ затрагивается —
-- его дефолтом служит компил-таймовая константа AI_SYSTEM в коде,
-- так что админ видит «реальный» промпт и сравнивает с override'ом
-- через ответ /api/settings.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('temperature',  '0.2'),
  ('max_tokens',   '900'),
  ('catalog_topk', '6'),
  ('vector_topk',  '5');

-- Bootstrap schema_migrations — на случай чистой D1 без 0001.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT    PRIMARY KEY,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0005_settings');
