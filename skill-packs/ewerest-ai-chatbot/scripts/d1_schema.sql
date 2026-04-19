-- scripts/d1_schema.sql — схема D1 для ewerest-ai-chatbot
-- Применить: wrangler d1 execute DB --file=scripts/d1_schema.sql --remote

-- История диалогов (память бота)
CREATE TABLE IF NOT EXISTS chat_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_history(ts);

-- Документы базы знаний (метаданные; тело в R2)
CREATE TABLE IF NOT EXISTS documents (
  doc_id       TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT DEFAULT 'other',
  r2_key       TEXT NOT NULL,
  filename     TEXT,
  size         INTEGER,
  chunks       INTEGER DEFAULT 0,
  indexed      INTEGER DEFAULT 0,
  uploaded_at  INTEGER NOT NULL,
  indexed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_docs_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_docs_indexed ON documents(indexed);

-- Каталог подшипников (1:1 с XLSX Эверест)
CREATE TABLE IF NOT EXISTS catalog (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number   TEXT NOT NULL,
  brand         TEXT,
  family        TEXT,
  name          TEXT,
  d             REAL,
  D             REAL,
  H             REAL,
  mass          REAL,
  execution     TEXT,
  clearance     TEXT,
  class         TEXT,
  analog_gost   TEXT,
  analog_iso    TEXT,
  price         REAL,
  currency      TEXT DEFAULT 'RUB',
  stock         INTEGER DEFAULT 0,
  image_url     TEXT,
  updated_at    INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_part ON catalog(part_number);
CREATE INDEX IF NOT EXISTS idx_catalog_brand ON catalog(brand);
CREATE INDEX IF NOT EXISTS idx_catalog_geom ON catalog(d, D, H);
CREATE INDEX IF NOT EXISTS idx_catalog_gost ON catalog(analog_gost);
CREATE INDEX IF NOT EXISTS idx_catalog_iso ON catalog(analog_iso);

-- Конфиг бота (key/value)
CREATE TABLE IF NOT EXISTS config (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  INTEGER
);

-- Лиды (опционально — если клиент оставил контакты через бота)
CREATE TABLE IF NOT EXISTS leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT,
  name         TEXT,
  phone        TEXT,
  email        TEXT,
  company      TEXT,
  inn          TEXT,
  request      TEXT,
  created_at   INTEGER NOT NULL,
  synced_b24   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_synced ON leads(synced_b24);

-- Начальный конфиг
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('temperature',    '0.3',    strftime('%s','now') * 1000),
  ('max_tokens',     '1024',   strftime('%s','now') * 1000),
  ('catalog_top_k',  '5',      strftime('%s','now') * 1000),
  ('kb_top_k',       '5',      strftime('%s','now') * 1000),
  ('history_turns',  '10',     strftime('%s','now') * 1000);
