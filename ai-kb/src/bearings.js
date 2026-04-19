// ai-kb/src/bearings.js
// Геометрический поиск аналогов по точному совпадению d × D × B.
// Используется в handleChat дополнительно к FTS+Vectorize: если в запросе
// есть тройка размеров, отдаём LLM кандидатов которые физически
// совпадают, минуя текстовый матч (FTS не отличит 6204-ZZ от 6204-2RS).

/**
 * Достаёт тройку d×D×B из произвольного текста запроса.
 * Поддержка разделителей: x | х | * (разные раскладки и жаргон).
 * Допускает дробные мм через . или ,.
 *
 * @returns {{d_inner:number, d_outer:number, width:number} | null}
 */
export function extractDimensions(query) {
  if (!query) return null;
  const re = /(\d+(?:[\.,]\d+)?)\s*[xх*×]\s*(\d+(?:[\.,]\d+)?)\s*[xх*×]\s*(\d+(?:[\.,]\d+)?)/i;
  const m = String(query).match(re);
  if (!m) return null;
  const [, a, b, c] = m;
  const num = (s) => parseFloat(s.replace(',', '.'));
  const d_inner = num(a);
  const d_outer = num(b);
  const width = num(c);
  // Sanity check: подшипники в каталоге — d > 0, D > d, B > 0.
  if (!Number.isFinite(d_inner) || !Number.isFinite(d_outer) || !Number.isFinite(width)) return null;
  if (d_inner <= 0 || d_outer <= d_inner || width <= 0) return null;
  return { d_inner, d_outer, width };
}

/**
 * Best-effort bearing-type hint from free-form query. Returns one of the
 * canonical type tokens we can match against catalog.type / base_number.
 * Returns null if the query has no type signal — caller MUST refuse to
 * run a geometric search in that case (different types share d×D×B).
 *
 * Examples:
 *   "аналог NU205 25x52x15"  → 'NU'
 *   "6205 2RS C3"            → '6xxx'
 *   "32205"                  → '32xxx'
 *   "25x52x15"               → null  (ambiguous — could be ball or roller)
 */
export function extractBearingTypeHint(query) {
  if (!query) return null;
  const s = String(query).toUpperCase();
  // Cylindrical roller letter prefixes — most specific, check first.
  const rollerLetter = s.match(/\b(NUP|NJP|NUJ|NUP|NU|NJ|NF|NP|N)\b/);
  if (rollerLetter) return rollerLetter[1];
  // 5-digit ISO conical/spherical roller series (30xxx, 31xxx, 32xxx,
  // 22xxx, 23xxx). Check before 4-digit ball series.
  const fiveDigit = s.match(/\b(30|31|32|22|23)\d{3}\b/);
  if (fiveDigit) return fiveDigit[1] + 'xxx';
  // ISO 4-digit ball series (60xx, 62xx, 63xx, 64xx, 70xx, 72xx, 73xx).
  const fourBall = s.match(/\b(60|62|63|64|70|72|73|16)\d{2}\b/);
  if (fourBall) return fourBall[1] + 'xx';
  // GOST 4-digit tapered roller (7xxx, 8xxx start).
  const gostNumeric = s.match(/\b([78])\d{3}\b/);
  if (gostNumeric) return gostNumeric[1] + 'xxx';
  return null;
}

function typeFilterClause(typeHint) {
  // Translate the canonical hint into a SQL fragment. Filters BOTH
  // catalog.type (text label) and catalog.base_number (when type is
  // missing data, the prefix still constrains).
  if (!typeHint) return null;
  if (/^[A-Z]+$/.test(typeHint)) {
    // Roller letter prefix like "NU" — match base_number prefix.
    return { sql: 'AND base_number GLOB ?', param: typeHint + '*' };
  }
  if (typeHint.endsWith('xxx')) {
    return { sql: 'AND base_number GLOB ?', param: typeHint.slice(0, 2) + '???*' };
  }
  if (typeHint.endsWith('xx')) {
    return { sql: 'AND base_number GLOB ?', param: typeHint.slice(0, 2) + '??*' };
  }
  return null;
}

/**
 * Точный геометрический поиск в catalog. Тип ОБЯЗАТЕЛЕН: один и тот же
 * d×D×B встречается у шариковых и роликовых одновременно, и без типа
 * блок «геометрически совместим» вводит LLM в заблуждение. Если хинта
 * типа нет — возвращаем пусто.
 *
 * Sort: in-stock first, then known-priced first (price=0 ⇒ unknown,
 * sink to bottom), then cheapest.
 *
 * @param {D1Database} db        env.DB
 * @param {number}     d_inner   мм
 * @param {number}     d_outer   мм
 * @param {number}     width     мм (B)
 * @param {string|null} typeHint canonical type token, see extractBearingTypeHint
 * @param {string|null} excludeBaseNumber  не возвращать сам исходник
 * @param {number}     limit
 */
export async function findAnalogsByDimensions(db, d_inner, d_outer, width, typeHint = null, excludeBaseNumber = null, limit = 10) {
  const filter = typeFilterClause(typeHint);
  if (!filter) return [];   // refuse to mix types
  let sql =
    'SELECT base_number, brand, type, gost_equiv, iso_equiv, ' +
    'd_inner, d_outer, width_mm, seal, clearance, price_rub, qty ' +
    'FROM catalog ' +
    'WHERE d_inner = ? AND d_outer = ? AND width_mm = ? ' + filter.sql;
  const params = [d_inner, d_outer, width, filter.param];
  if (excludeBaseNumber) {
    sql += ' AND base_number != ?';
    params.push(excludeBaseNumber);
  }
  sql += ' ORDER BY (qty > 0) DESC, (price_rub > 0) DESC, price_rub ASC LIMIT ?';
  params.push(limit);
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

/**
 * Форматирует ряд под уже существующий buildContext(): тот же словарь
 * полей что и searchCatalog, плюс пометка для LLM что это GEO-точное
 * совпадение, не fuzzy.
 */
export function geoRowToText(r) {
  const parts = [`Подшипник ${r.base_number} (геометрически совместим)`];
  if (r.brand) parts.push(`бренд ${r.brand}`);
  if (r.type) parts.push(`тип ${r.type}`);
  parts.push(`размеры d=${r.d_inner} D=${r.d_outer} B=${r.width_mm}`);
  if (r.gost_equiv) parts.push(`ГОСТ ${r.gost_equiv}`);
  if (r.iso_equiv)  parts.push(`ISO ${r.iso_equiv}`);
  if (r.seal)       parts.push(`уплотнение ${r.seal}`);
  if (r.clearance)  parts.push(`зазор ${r.clearance}`);
  if (r.price_rub)  parts.push(`цена ${r.price_rub} руб`);
  if (r.qty)        parts.push(`остаток ${r.qty}`);
  return parts.join(', ');
}
