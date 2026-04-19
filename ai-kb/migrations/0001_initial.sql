-- ============================================================
-- Миграция 0001: начальная схема для ai-kb (D1: baza)
-- Worker: ai-kb | Cloudflare D1 database: baza
-- ============================================================

-- База знаний: документы (ГОСТ, инструкции, договоры, тех. данные)
CREATE TABLE IF NOT EXISTS knowledge_base (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL DEFAULT 'docs',   -- gost | manual | docs | faq | other
  title       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  keywords    TEXT,                              -- источник / теги (plain text)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_base (category);
CREATE INDEX IF NOT EXISTS idx_kb_created  ON knowledge_base (created_at DESC);

-- FTS5 полнотекстовый поиск по базе знаний
CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
  title,
  content,
  keywords,
  content='knowledge_base',
  content_rowid='id'
);

-- Триггеры синхронизации FTS ↔ knowledge_base
CREATE TRIGGER IF NOT EXISTS kb_fts_insert AFTER INSERT ON knowledge_base BEGIN
  INSERT INTO kb_fts (rowid, title, content, keywords)
  VALUES (new.id, new.title, new.content, new.keywords);
END;

CREATE TRIGGER IF NOT EXISTS kb_fts_update AFTER UPDATE ON knowledge_base BEGIN
  INSERT INTO kb_fts (kb_fts, rowid, title, content, keywords)
  VALUES ('delete', old.id, old.title, old.content, old.keywords);
  INSERT INTO kb_fts (rowid, title, content, keywords)
  VALUES (new.id, new.title, new.content, new.keywords);
END;

CREATE TRIGGER IF NOT EXISTS kb_fts_delete AFTER DELETE ON knowledge_base BEGIN
  INSERT INTO kb_fts (kb_fts, rowid, title, content, keywords)
  VALUES ('delete', old.id, old.title, old.content, old.keywords);
END;

-- ============================================================
-- Сессии чата (постоянная память разговоров)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT    PRIMARY KEY,               -- UUID
  title       TEXT,                              -- авто-заголовок из первого сообщения
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON chat_sessions (updated_at DESC);

-- ============================================================
-- История сообщений чата
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT    NOT NULL,
  sources     INTEGER NOT NULL DEFAULT 0,        -- кол-во источников из KB/catalog
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages (session_id, created_at ASC);

-- ============================================================
-- Лог запросов к /api/ask (аналитика + дебаг)
-- ============================================================
CREATE TABLE IF NOT EXISTS query_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  question    TEXT    NOT NULL,
  answer_len  INTEGER,
  sources_kb  INTEGER NOT NULL DEFAULT 0,
  sources_cat INTEGER NOT NULL DEFAULT 0,
  model       TEXT,
  latency_ms  INTEGER,
  error       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_qlog_created ON query_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qlog_session ON query_log (session_id);
