-- ============================================================
-- Миграция 0002: файлы, правила, FTS-индекс каталога
-- Worker: ai-kb + b24-catalog | D1: baza
--
-- Зависимости (должны быть применены до этой миграции):
--   migrations/0001_root_schema.sql    — создаёт таблицы catalog,
--     import_sessions, orders, admin_audit_log, schema_migrations
--   ai-kb/migrations/0001_initial.sql  — создаёт knowledge_base,
--     chat_sessions, chat_messages, query_log
--
-- Применение:
--   wrangler d1 execute baza --remote --file ai-kb/migrations/0002_files_rules_catalog.sql
-- Миграция идемпотентна (IF NOT EXISTS).
--
-- Примечание по внешним ключам: Cloudflare D1 поддерживает FK,
-- но не включает их принудительную проверку автоматически.
-- Для включения добавьте PRAGMA foreign_keys = ON; в начало
-- каждого сеанса соединения или выполните команду ниже.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- Настройки ai-kb (KV-хранилище в D1, ранее создавалось лениво)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- Загруженные файлы (PDF, DOCX, XLSX, изображения, аудио)
-- ============================================================
CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key       TEXT    NOT NULL UNIQUE,             -- ключ в R2-бакете
  filename     TEXT    NOT NULL,
  mime_type    TEXT,
  size_bytes   INTEGER,
  status       TEXT    NOT NULL DEFAULT 'pending',  -- pending | processing | done | error
  error        TEXT,                                -- сообщение об ошибке (если status=error)
  uploaded_by  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_status     ON files (status);
CREATE INDEX IF NOT EXISTS idx_files_created    ON files (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_uploaded   ON files (uploaded_by, created_at DESC);

-- ============================================================
-- Текстовые чанки, извлечённые из файлов (для векторизации)
-- ============================================================
CREATE TABLE IF NOT EXISTS file_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT    NOT NULL,
  vector_id   TEXT,                                -- ID вектора в Vectorize (kb-{file_id}-{chunk_index})
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_file_chunks_file   ON file_chunks (file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_file_chunks_vector ON file_chunks (vector_id) WHERE vector_id IS NOT NULL;

-- ============================================================
-- Медиа-активы (изображения, аудио) в R2
-- ============================================================
CREATE TABLE IF NOT EXISTS media_assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key     TEXT    NOT NULL UNIQUE,
  filename   TEXT    NOT NULL,
  mime_type  TEXT,
  size_bytes INTEGER,
  ref_type   TEXT,                                 -- 'catalog' | 'kb' | 'order'
  ref_id     INTEGER,                              -- FK к связанной сущности
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_ref ON media_assets (ref_type, ref_id);

-- ============================================================
-- Бизнес-правила / инструкции для AI-ассистента
-- ============================================================
CREATE TABLE IF NOT EXISTS rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,              -- машиночитаемый ключ
  content    TEXT    NOT NULL,                     -- текст правила
  enabled    INTEGER NOT NULL DEFAULT 1,           -- 0 = отключено
  priority   INTEGER NOT NULL DEFAULT 0,           -- порядок применения (DESC)
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules (enabled, priority DESC);

-- ============================================================
-- Очередь асинхронных задач (ingest, reindex, OCR, import)
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT    NOT NULL,                   -- ingest | reindex | ocr | import_catalog | transcribe
  status       TEXT    NOT NULL DEFAULT 'pending', -- pending | running | done | error
  payload_json TEXT,                               -- входные параметры (JSON)
  result_json  TEXT,                               -- результат (JSON)
  error        TEXT,                               -- сообщение об ошибке
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs (status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_type    ON jobs (type, status);

-- ============================================================
-- Лог операций очистки (orphan R2, устаревший query_log и т.д.)
-- ============================================================
CREATE TABLE IF NOT EXISTS cleanup_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  operation     TEXT    NOT NULL,                  -- purge_r2_orphans | thin_query_log | ...
  deleted_count INTEGER NOT NULL DEFAULT 0,
  details_json  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cleanup_created ON cleanup_log (created_at DESC);

-- ============================================================
-- FTS5-индекс каталога (ускоряет searchCatalog в ai-kb/src/index.js)
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(
  base_number,
  gost_equiv,
  iso_equiv,
  brand,
  content='catalog',
  content_rowid='id'
);

-- Первичное наполнение FTS (требует, чтобы таблица catalog уже
-- существовала — она создаётся в migrations/0001_root_schema.sql).
-- Если catalog пустой, запрос вернёт 0 строк — это безопасно.
-- При повторном запуске migration-строки дублируются в FTS-индексе;
-- для пересборки используйте: INSERT INTO catalog_fts(catalog_fts) VALUES('rebuild');
INSERT INTO catalog_fts (rowid, base_number, gost_equiv, iso_equiv, brand)
SELECT id, base_number, gost_equiv, iso_equiv, brand FROM catalog
WHERE NOT EXISTS (SELECT 1 FROM catalog_fts LIMIT 1);

-- Триггеры синхронизации FTS ↔ catalog
CREATE TRIGGER IF NOT EXISTS catalog_fts_insert
AFTER INSERT ON catalog BEGIN
  INSERT INTO catalog_fts (rowid, base_number, gost_equiv, iso_equiv, brand)
  VALUES (new.id, new.base_number, new.gost_equiv, new.iso_equiv, new.brand);
END;

CREATE TRIGGER IF NOT EXISTS catalog_fts_update
AFTER UPDATE ON catalog BEGIN
  INSERT INTO catalog_fts (catalog_fts, rowid, base_number, gost_equiv, iso_equiv, brand)
  VALUES ('delete', old.id, old.base_number, old.gost_equiv, old.iso_equiv, old.brand);
  INSERT INTO catalog_fts (rowid, base_number, gost_equiv, iso_equiv, brand)
  VALUES (new.id, new.base_number, new.gost_equiv, new.iso_equiv, new.brand);
END;

CREATE TRIGGER IF NOT EXISTS catalog_fts_delete
AFTER DELETE ON catalog BEGIN
  INSERT INTO catalog_fts (catalog_fts, rowid, base_number, gost_equiv, iso_equiv, brand)
  VALUES ('delete', old.id, old.base_number, old.gost_equiv, old.iso_equiv, old.brand);
END;

-- ============================================================
-- Версия миграции
-- ============================================================
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0002_files_rules_catalog');
