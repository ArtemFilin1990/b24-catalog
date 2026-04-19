-- ============================================================
-- Миграция 0001: схема root-воркера b24-catalog (D1: baza)
-- Worker: b24-catalog | Cloudflare D1 database: baza (shared with ai-kb)
--
-- Таблицы ниже создавались воркером на лету (lazy CREATE в коде) — это
-- фиксация текущей схемы + недостающие индексы на «горячих» колонках.
-- Применение (локально):
--   wrangler d1 execute baza --remote --file=migrations/0001_root_schema.sql
-- Миграция идемпотентна (IF NOT EXISTS + defensive ALTER обработан
-- вручную вне этого файла — на D1 нет ALTER IF NOT EXISTS).
-- ============================================================

-- Каталог подшипников (основная таблица, чтение только).
CREATE TABLE IF NOT EXISTS catalog (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  base_number   TEXT    NOT NULL,
  brand         TEXT,
  type          TEXT,
  standard      TEXT,
  gost_equiv    TEXT,
  iso_equiv     TEXT,
  skf_analog    TEXT,
  fag_analog    TEXT,
  nsk_analog    TEXT,
  ntn_analog    TEXT,
  zwz_analog    TEXT,
  d_inner       REAL,
  d_outer       REAL,
  width_mm      REAL,
  t_mm          REAL,
  mass_kg       REAL,
  seal          TEXT,
  precision     TEXT,
  clearance     TEXT,
  cage          TEXT,
  execution     TEXT,
  cr_kn         REAL,
  c0r_kn        REAL,
  n_grease_rpm  INTEGER,
  n_oil_rpm     INTEGER,
  price_rub     REAL DEFAULT 0,
  qty           INTEGER DEFAULT 0,
  status        INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_catalog_base_number ON catalog (base_number);
CREATE INDEX IF NOT EXISTS idx_catalog_gost_equiv  ON catalog (gost_equiv);
CREATE INDEX IF NOT EXISTS idx_catalog_iso_equiv   ON catalog (iso_equiv);

-- Импорты / загрузки каталогов пользователем.
CREATE TABLE IF NOT EXISTS import_sessions (
  id           TEXT    PRIMARY KEY,
  uploaded_by  TEXT,
  uploaded_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  filename     TEXT,
  format       TEXT,
  rows_count   INTEGER DEFAULT 0,
  status       TEXT    DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_import_sessions_uploaded ON import_sessions (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_sessions_status   ON import_sessions (status);

-- Импортированные строки (сырые + нормализованные поля для поиска).
CREATE TABLE IF NOT EXISTS imported_rows (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT,
  uploaded_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  uploaded_by     TEXT,
  session_id      TEXT    NOT NULL,
  data            TEXT    NOT NULL,       -- полный JSON исходной строки
  base_number     TEXT,
  brand           TEXT,
  price_rub       REAL,
  quantity        INTEGER,
  diam_inner_mm   REAL,
  diam_outer_mm   REAL,
  width_mm        REAL,
  deleted         INTEGER NOT NULL DEFAULT 0
);

-- Горячие колонки: session_id (soft delete), uploaded_at (list).
CREATE INDEX IF NOT EXISTS idx_imported_rows_session  ON imported_rows (session_id) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_imported_rows_upload   ON imported_rows (uploaded_at DESC) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_imported_rows_base     ON imported_rows (base_number)    WHERE deleted = 0;

-- Заявки от клиентов из каталожного фронта.
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name  TEXT,
  inn           TEXT,
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  comment       TEXT,
  total_rub     REAL,
  items_json    TEXT,
  status        TEXT    NOT NULL DEFAULT 'new',   -- new | in_progress | done | cancelled
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_email   ON orders (email);
CREATE INDEX IF NOT EXISTS idx_orders_phone   ON orders (phone);

-- Админский аудит-лог (запись каждой чувствительной операции).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT    NOT NULL,               -- backup | orders.list | imports.soft_delete | r2.upload | ...
  resource    TEXT,                           -- ID/путь ресурса
  meta        TEXT,                           -- свободный JSON с деталями
  ip          TEXT,                           -- CF-Connecting-IP
  ua          TEXT,                           -- User-Agent
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON admin_audit_log (action, created_at DESC);

-- Версия миграций — удобно отслеживать применённые шаги.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT    PRIMARY KEY,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0001_root_schema');
