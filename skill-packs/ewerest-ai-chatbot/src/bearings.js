// src/bearings.js — детект и нормализация подшипника, поиск аналогов
// Правило: ГОСТ ⇄ ISO только при полном совпадении type + series + d/D/B + execution.
// Если нет — `NO DIRECT EQUIV`.

const EXECUTION_SUFFIXES = [
  "2RS", "2RSR", "2RS1", "2Z", "ZZ", "RS", "Z",
  "C0", "C1", "C2", "C3", "C4", "C5",
  "P0", "P2", "P4", "P5", "P6",
  "K", "N", "NR", "M", "TN", "E", "EC", "J", "TVH"
];

const ISO_REGEX = /\b([0-9]{4,7})\s*[- ]?\s*(2RS|ZZ|RS|Z|2Z|N|NR|K|M|TN|C3|C4|P5|P6|EC|E)?\b/i;
const GOST_REGEX = /\b([0-9]{7,8})\b/;

export function detectBearing(text) {
  if (!text) return null;
  const gostMatch = text.match(GOST_REGEX);
  if (gostMatch) {
    return { raw: gostMatch[0], base: gostMatch[1], execution: null, standard: "gost" };
  }
  const isoMatch = text.match(ISO_REGEX);
  if (isoMatch) {
    return {
      raw: isoMatch[0].trim(),
      base: isoMatch[1],
      execution: isoMatch[2] ? isoMatch[2].toUpperCase() : null,
      standard: "iso",
    };
  }
  return null;
}

export function normalize(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[/\\]/g, "-").toUpperCase();
  const brands = ["SKF", "FAG", "NSK", "NTN", "ZWZ", "LYC", "HRB", "ГПЗ", "ЕПК", "IKO", "TIMKEN", "KOYO"];
  let brand = null;
  let rest = cleaned;
  for (const b of brands) {
    if (cleaned.includes(b)) {
      brand = b;
      rest = cleaned.replace(b, "").trim();
      break;
    }
  }
  const baseMatch = rest.match(/([0-9]{4,8})/);
  const base = baseMatch ? baseMatch[1] : null;
  const suffixes = [];
  for (const s of EXECUTION_SUFFIXES) {
    const re = new RegExp(`\\b${s}\\b`, "i");
    if (re.test(rest)) suffixes.push(s);
  }
  return { brand, base, suffixes, raw };
}

export async function enrichBearingContext(env, hint) {
  if (!hint || !hint.base) return null;
  const row = await env.DB.prepare(
    `SELECT part_number, brand, name, d, D, H, analog_gost, analog_iso, execution, clearance
     FROM catalog
     WHERE part_number LIKE ?1 OR analog_gost LIKE ?1 OR analog_iso LIKE ?1
     LIMIT 1`
  )
    .bind(`%${hint.base}%`)
    .first();

  if (!row) {
    return {
      summary: `Подшипник ${hint.raw}: в каталоге D1 не найден. [[TBD]] — проверить поставщика.`,
      found: false,
    };
  }

  const analogs = await findAnalogs(env, row);
  return {
    summary:
      `Найдено в каталоге: ${row.part_number} (${row.brand}). ` +
      `d=${row.d} D=${row.D} H=${row.H}. ` +
      `Исполнение: ${row.execution || "—"}. Зазор: ${row.clearance || "—"}.`,
    found: true,
    item: row,
    analogs,
  };
}

async function findAnalogs(env, item) {
  if (!item.d || !item.D || !item.H) {
    return [{ note: "NO DIRECT EQUIV", reason: "incomplete geometry" }];
  }

  const { results } = await env.DB.prepare(
    `SELECT part_number, brand, d, D, H, execution
     FROM catalog
     WHERE d = ?1 AND D = ?2 AND H = ?3
       AND (execution = ?4 OR (execution IS NULL AND ?4 IS NULL))
       AND part_number != ?5
     LIMIT 5`
  )
    .bind(item.d, item.D, item.H, item.execution, item.part_number)
    .all();

  if (!results || results.length === 0) {
    return [{ note: "NO DIRECT EQUIV", reason: "no full-match bearing in catalog" }];
  }
  return results;
}
