-- ============================================================
-- Миграция 0004: мастер-представление каталога
-- Worker: b24-catalog + ai-kb | D1: baza
--
-- v_catalog — единое представление активных позиций:
--   • все строки из основной таблицы catalog
--   • плюс строки из catalog_staging, где review_status = 'promoted'
--
-- Приложение использует v_catalog как read-only источник для
-- поиска и выдачи в AI. Запись всегда идёт в catalog или
-- catalog_staging напрямую.
--
-- Применение:
--   wrangler d1 execute baza --remote --file ai-kb/migrations/0004_catalog_master_view.sql
-- ============================================================

-- D1 поддерживает CREATE VIEW IF NOT EXISTS начиная с runtime v3.
DROP VIEW IF EXISTS v_catalog;

CREATE VIEW v_catalog AS
  SELECT
    id,
    base_number,
    brand,
    type,
    standard,
    gost_equiv,
    iso_equiv,
    skf_analog,
    fag_analog,
    nsk_analog,
    ntn_analog,
    zwz_analog,
    d_inner,
    d_outer,
    width_mm,
    t_mm,
    mass_kg,
    seal,
    precision,
    clearance,
    cage,
    execution,
    cr_kn,
    c0r_kn,
    n_grease_rpm,
    n_oil_rpm,
    price_rub,
    qty,
    status,
    'catalog' AS source      -- для диагностики откуда пришла строка
  FROM catalog

  UNION ALL

  SELECT
    id,
    base_number,
    brand,
    type,
    standard,
    gost_equiv,
    iso_equiv,
    skf_analog,
    fag_analog,
    nsk_analog,
    ntn_analog,
    zwz_analog,
    d_inner,
    d_outer,
    width_mm,
    t_mm,
    mass_kg,
    seal,
    precision,
    clearance,
    cage,
    execution,
    cr_kn,
    c0r_kn,
    n_grease_rpm,
    n_oil_rpm,
    price_rub,
    qty,
    status,
    'staging' AS source
  FROM catalog_staging
  WHERE review_status = 'promoted';

-- ============================================================
-- Версия миграции
-- ============================================================
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0004_catalog_master_view');
