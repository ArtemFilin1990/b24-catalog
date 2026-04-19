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
 * Точный геометрический поиск в catalog. Сортируем по наличию (qty DESC)
 * и цене ASC, чтобы LLM в первую очередь видел ходовые позиции.
 *
 * @param {D1Database} db        env.DB
 * @param {number}     d_inner   мм
 * @param {number}     d_outer   мм
 * @param {number}     width     мм (B)
 * @param {string|null} excludeBaseNumber  не возвращать сам исходник
 * @param {number}     limit
 */
export async function findAnalogsByDimensions(db, d_inner, d_outer, width, excludeBaseNumber = null, limit = 10) {
  let sql =
    'SELECT base_number, brand, type, gost_equiv, iso_equiv, ' +
    'd_inner, d_outer, width_mm, seal, clearance, price_rub, qty ' +
    'FROM catalog ' +
    'WHERE d_inner = ? AND d_outer = ? AND width_mm = ?';
  const params = [d_inner, d_outer, width];
  if (excludeBaseNumber) {
    sql += ' AND base_number != ?';
    params.push(excludeBaseNumber);
  }
  sql += ' ORDER BY (qty > 0) DESC, COALESCE(price_rub, 0) ASC LIMIT ?';
  params.push(limit);
  try {
    const { results } = await db.prepare(sql).bind(...params).all();
    return results || [];
  } catch {
    return [];
  }
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
