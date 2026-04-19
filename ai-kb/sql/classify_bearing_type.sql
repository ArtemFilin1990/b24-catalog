-- =========================================================
-- classify_bearing_type.sql
-- MVP auto-classification of catalog_rows.bearing_type using
-- a pure CASE on prefix / number patterns. No dependency on
-- bearing_rules yet — that comes as the next-layer upgrade.
--
-- NOT a migration. Applied per file with :file_id bound by
-- the ingest worker. Split on "-- @@ <name>" markers.
--
-- Ordering rule (first match wins):
--   1. Letter-prefixed ISO families    (NU / NJ / NF ...)     — unambiguous
--   2. Letter-prefixed ISO angular     (7xxxC / 7xxxB / ...)  — unambiguous
--   3. 6-digit GOST deep-groove forms  (180xxx / 80xxxx / 60xxxx)
--   4. 5-digit roller families         (302xx .. 332xx, 22xxx, 23xxx)
--   5. 5-digit GOST seal-prefix forms  (60xxx = Z, 80xxx = 2Z, 160xxx = RS)
--   6. 5-digit thrust roller           (81xxx)
--   7. 4-digit ball / thrust families  (6xxx, 7xxx, 8xxx, 51-54xxx core)
--   8. 4-digit GOST tapered (72-76xx)  — overridden if ISO-letter prefix present
--   9. 3-digit GOST radial ball cores  (1xx / 2xx / 3xx / 4xx)
--  10. everything else                 → 'unknown'
--
-- Ambiguity notes documented in the commit message, not here.
-- =========================================================


-- @@ classify_update
UPDATE catalog_rows
SET bearing_type = (
  WITH
    -- normalized uppercase prefix and pure-digit number
    n AS (
      SELECT
        UPPER(TRIM(COALESCE(catalog_rows.prefix, '')))    AS pfx,
        TRIM(COALESCE(catalog_rows.number, ''))           AS num,
        UPPER(TRIM(COALESCE(catalog_rows.analog, '')))    AS ana
    )
  SELECT CASE

    -- 1) Letter-prefix cylindrical roller (ISO)
    WHEN (SELECT pfx FROM n) IN ('NU','NJ','NUP','NF','N','NP','NUJ','NH','NCL')
      THEN 'cylindrical_roller'

    -- 2) Letter-prefix angular contact ball (ISO 7xxxC / 7xxxB / 7xxxAC)
    WHEN (SELECT pfx FROM n) IN ('QJ')
      THEN 'angular_contact_ball'

    -- 3) 6-digit GOST deep-groove seal/shield forms
    --    180205 → 6205-2RS, 80205 → 6205-2Z, 60205 → 6205-Z
    WHEN (SELECT num FROM n) GLOB '180[0-9][0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '80[0-9][0-9][0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '60[0-9][0-9][0-9][0-9]' THEN 'deep_groove_ball'

    -- 4) 5-digit spherical roller (22xxx, 23xxx, 35xxx, 31xxxx, 39xxxx)
    WHEN (SELECT num FROM n) GLOB '22[0-9][0-9][0-9]' THEN 'spherical_roller'
    WHEN (SELECT num FROM n) GLOB '23[0-9][0-9][0-9]' THEN 'spherical_roller'
    WHEN (SELECT num FROM n) GLOB '35[0-9][0-9][0-9]' THEN 'spherical_roller'
    WHEN (SELECT num FROM n) GLOB '31[0-9][0-9][0-9][0-9]' THEN 'spherical_roller'
    WHEN (SELECT num FROM n) GLOB '39[0-9][0-9][0-9][0-9]' THEN 'spherical_roller'

    -- 4b) 5-digit tapered roller ISO: 302xx, 303xx, 320xx, 322xx, 323xx, 332xx
    WHEN (SELECT num FROM n) GLOB '302[0-9][0-9]' THEN 'tapered_roller'
    WHEN (SELECT num FROM n) GLOB '303[0-9][0-9]' THEN 'tapered_roller'
    WHEN (SELECT num FROM n) GLOB '320[0-9][0-9]' THEN 'tapered_roller'
    WHEN (SELECT num FROM n) GLOB '322[0-9][0-9]' THEN 'tapered_roller'
    WHEN (SELECT num FROM n) GLOB '323[0-9][0-9]' THEN 'tapered_roller'
    WHEN (SELECT num FROM n) GLOB '332[0-9][0-9]' THEN 'tapered_roller'

    -- 4c) GOST tapered extended forms: 2007xxx, 3007xxx, 27xxx
    WHEN (SELECT num FROM n) GLOB '2007[0-9][0-9][0-9]' THEN 'tapered_roller'
    WHEN (SELECT num FROM n) GLOB '3007[0-9][0-9][0-9]' THEN 'tapered_roller'
    WHEN (SELECT num FROM n) GLOB '27[0-9][0-9][0-9]' THEN 'tapered_roller'

    -- 5) 5-digit angular contact GOST: 36xxxx / 46xxxx / 66xxxx
    WHEN (SELECT num FROM n) GLOB '36[0-9][0-9][0-9][0-9]' THEN 'angular_contact_ball'
    WHEN (SELECT num FROM n) GLOB '46[0-9][0-9][0-9][0-9]' THEN 'angular_contact_ball'
    WHEN (SELECT num FROM n) GLOB '66[0-9][0-9][0-9][0-9]' THEN 'angular_contact_ball'

    -- 6) 5-digit thrust roller: 81xxx
    WHEN (SELECT num FROM n) GLOB '81[0-9][0-9][0-9]' THEN 'thrust_roller'

    -- 7) 5-digit thrust ball core: 51xxx / 52xxx / 53xxx / 54xxx
    WHEN (SELECT num FROM n) GLOB '51[0-9][0-9][0-9]' THEN 'thrust_ball'
    WHEN (SELECT num FROM n) GLOB '52[0-9][0-9][0-9]' THEN 'thrust_ball'
    WHEN (SELECT num FROM n) GLOB '53[0-9][0-9][0-9]' THEN 'thrust_ball'
    WHEN (SELECT num FROM n) GLOB '54[0-9][0-9][0-9]' THEN 'thrust_ball'

    -- 8) 4-digit ISO deep-groove ball: 60xx / 62xx / 63xx / 64xx
    WHEN (SELECT num FROM n) GLOB '60[0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '62[0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '63[0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '64[0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '16[0-9][0-9][0-9]' THEN 'deep_groove_ball'

    -- 9) 4-digit ISO angular contact ball: 7xxx
    --    Ambiguity with GOST 4-digit 7xxx (tapered) is resolved by
    --    the analog column — if analog looks like ISO 30/32xxx, it's tapered.
    WHEN (SELECT num FROM n) GLOB '7[0-9][0-9][0-9]'
         AND (SELECT ana FROM n) GLOB '3[02]*'
      THEN 'tapered_roller'
    WHEN (SELECT num FROM n) GLOB '7[0-9][0-9][0-9]'
      THEN 'angular_contact_ball'

    -- 10) 4-digit GOST thrust ball: 8xxx (8205, 8305, ...)
    WHEN (SELECT num FROM n) GLOB '8[0-9][0-9][0-9]' THEN 'thrust_ball'

    -- 11) 3-digit GOST radial ball cores: 1xx / 2xx / 3xx / 4xx
    WHEN (SELECT num FROM n) GLOB '1[0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '2[0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '3[0-9][0-9]' THEN 'deep_groove_ball'
    WHEN (SELECT num FROM n) GLOB '4[0-9][0-9]' THEN 'deep_groove_ball'

    -- 12) GOST open form: 0xxxxx (six-digit leading zero)
    WHEN (SELECT num FROM n) GLOB '0[0-9][0-9][0-9][0-9][0-9]' THEN 'deep_groove_ball'

    ELSE 'unknown'
  END
)
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI';


-- @@ classify_audit_unknowns
-- Surface rows that stayed 'unknown' after classification so
-- humans can curate patterns we missed.
SELECT
  id,
  row_index,
  prefix,
  number,
  suffix,
  designation_full,
  analog,
  d_mm, D_mm, B_mm
FROM catalog_rows
WHERE file_id = :file_id
  AND sheet_name = 'CATALOG_UI'
  AND bearing_type = 'unknown'
  AND validation_status IN ('valid', 'partial')
ORDER BY row_index
LIMIT 100;
