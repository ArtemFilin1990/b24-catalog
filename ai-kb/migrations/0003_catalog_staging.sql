-- ============================================================
-- Миграция 0003: стейджинг каталога
-- Worker: b24-catalog | D1: baza
--
-- catalog_staging — промежуточная таблица для импорта новых
-- позиций каталога. Строки остаются здесь до ручного/авто
-- подтверждения оператором; только после этого переезжают
-- в основную таблицу catalog (или отклоняются).
--
-- Применение:
--   wrangler d1 execute baza --remote --file ai-kb/migrations/0003_catalog_staging.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS catalog_staging (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Источник загрузки
  session_id      TEXT    NOT NULL,                -- логическая ссылка на import_sessions.id (FK не проверяется D1 без PRAGMA foreign_keys=ON)
  uploaded_by     TEXT,
  imported_at     TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Основные идентификаторы
  base_number     TEXT    NOT NULL,
  brand           TEXT,
  type            TEXT,
  standard        TEXT,
  gost_equiv      TEXT,
  iso_equiv       TEXT,

  -- Аналоги
  skf_analog      TEXT,
  fag_analog      TEXT,
  nsk_analog      TEXT,
  ntn_analog      TEXT,
  zwz_analog      TEXT,

  -- Геометрия
  d_inner         REAL,
  d_outer         REAL,
  width_mm        REAL,
  t_mm            REAL,
  mass_kg         REAL,

  -- Исполнение
  seal            TEXT,
  precision       TEXT,
  clearance       TEXT,
  cage            TEXT,
  execution       TEXT,

  -- Нагрузки / скорости
  cr_kn           REAL,
  c0r_kn          REAL,
  n_grease_rpm    INTEGER,
  n_oil_rpm       INTEGER,

  -- Коммерция
  price_rub       REAL    DEFAULT 0,
  qty             INTEGER DEFAULT 0,
  status          INTEGER DEFAULT 0,

  -- Статус в пайплайне
  -- pending   — ожидает проверки
  -- promoted  — перенесена в catalog
  -- rejected  — отклонена
  review_status   TEXT    NOT NULL DEFAULT 'pending',
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  review_note     TEXT
);

-- Горячие индексы
CREATE INDEX IF NOT EXISTS idx_staging_session   ON catalog_staging (session_id);
CREATE INDEX IF NOT EXISTS idx_staging_review    ON catalog_staging (review_status, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_staging_base      ON catalog_staging (base_number);

-- ============================================================
-- Версия миграции
-- ============================================================
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0003_catalog_staging');
