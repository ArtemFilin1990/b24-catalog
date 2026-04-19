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
  // Cylindrical roller letter prefixes — letters followed by digits.
  // \b doesn't fire between letter and digit (both are word chars), so
  // use a lookahead at a digit instead. Order longest-first so NUP wins
  // over NU.
  const rollerLetter = s.match(/\b(NUP|NJP|NUJ|NF|NP|NU|NJ|N)(?=\d)/);
  if (rollerLetter) return rollerLetter[1];

  // Explicit GOST qualifier flips the parse for numbers 7xxx/8xxx
  // (ambiguous between GOST tapered-roller/upor and ISO angular-ball).
  // If the query says "ГОСТ 7205", we must classify as tapered roller,
  // NOT ISO 72xx ball.
  // Cyrillic letters aren't word chars in default JS regex, so \b
  // around ГОСТ doesn't fire — use a plain substring check.
  const isGost = s.includes('ГОСТ') || /\bGOST\b/.test(s);

  // GOST 6-digit catalog codes (most specific, check before 5/4-digit).
  //   180xxx → 6xxx-2RS         ball (radial, two rubber seals)
  //   80xxx  → 6xxxZZ           ball (radial, two metal shields)
  //   60xxx  → 6xxxZ            ball (radial, one shield)
  //   50xxx  → 6xxxN            ball (radial, snap-ring groove)
  //   32xxxx → NUxxxx           cylindrical roller
  //   12xxxx → NJxxxx           cylindrical roller
  //   42xxxx → NUPxxxx          cylindrical roller
  //   2xxxx  → Nxxxx            cylindrical roller
  //   36xxxx → 7xxxC            angular-contact ball
  //   46xxxx → 7xxxAC           angular-contact ball
  //   66xxxx → 7xxxB            angular-contact ball
  if (/\b180\d{3}\b/.test(s) || /\b80\d{3}\b/.test(s) ||
      /\b60\d{3}\b/.test(s) || /\b50\d{3}\b/.test(s)) return '62XX';
  if (/\b36\d{4}\b/.test(s) || /\b46\d{4}\b/.test(s) || /\b66\d{4}\b/.test(s)) return '72XX';
  if (/\b32\d{4}\b/.test(s) || /\b42\d{4}\b/.test(s) || /\b12\d{4}\b/.test(s)) return 'NU';

  // GOST-qualified 4-digit takes priority over ISO 4-digit when the
  // leading digit is 7 (tapered roller) or 8 (thrust). Without the
  // qualifier we fall through to the generic ISO-first ordering below.
  if (isGost) {
    const gostFirst = s.match(/\b([78])\d{3}\b/);
    if (gostFirst) return gostFirst[1] + 'xxx';
  }

  // 5-digit ISO conical/spherical roller (30xxx, 31xxx, 32xxx, 22xxx, 23xxx).
  const fiveDigit = s.match(/\b(30|31|32|22|23)\d{3}\b/);
  if (fiveDigit) return fiveDigit[1] + 'xxx';
  // ISO 4-digit ball series (60xx, 62xx, 63xx, 64xx, 70xx, 72xx, 73xx, 16xx).
  const fourBall = s.match(/\b(60|62|63|64|70|72|73|16)\d{2}\b/);
  if (fourBall) return fourBall[1] + 'xx';
  // GOST 4-digit tapered roller (7xxx, 8xxx).
  const gostNumeric = s.match(/\b([78])\d{3}\b/);
  if (gostNumeric) return gostNumeric[1] + 'xxx';
  return null;
}

// Map canonical hint tokens to the russian-language labels stored in
// catalog.type (filled by the backfill). Returns an array of matching
// labels because some hints map to multiple legitimate types (e.g. 7xxx
// in GOST is tapered roller, in ISO is angular-contact ball — keep both).
function typeLabelsFor(typeHint) {
  if (!typeHint) return null;
  const T = typeHint.toUpperCase();
  // Cylindrical roller letter prefixes (ISO).
  if (['N', 'NU', 'NJ', 'NUP', 'NF', 'NP', 'NUJ', 'NJP'].includes(T)) {
    return ['Роликовый цилиндрический'];
  }
  // ISO ball families (4-digit). 6xx/16xx = radial, 7xx = angular-contact.
  if (['60XX', '62XX', '63XX', '64XX', '16XX'].includes(T)) {
    return ['Шариковый радиальный'];
  }
  if (['70XX', '72XX', '73XX'].includes(T)) {
    return ['Шариковый радиально-упорный'];
  }
  // 5-digit ISO roller series.
  if (T === '22XXX' || T === '23XXX') {
    return ['Роликовый сферический'];
  }
  if (T === '30XXX' || T === '31XXX' || T === '32XXX') {
    return ['Роликовый конический'];
  }
  // GOST 4-digit families. 7xxx = tapered roller per ГОСТ 333; 8xxx = upor.
  if (T === '7XXX') return ['Роликовый конический'];
  if (T === '8XXX') return ['Упорный шариковый', 'Упорный роликовый'];
  return null;
}

function typeFilterClause(typeHint) {
  const labels = typeLabelsFor(typeHint);
  if (!labels || labels.length === 0) return null;
  const placeholders = labels.map(() => '?').join(', ');
  return { sql: `AND type IN (${placeholders})`, params: labels };
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
  const params = [d_inner, d_outer, width, ...filter.params];
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
