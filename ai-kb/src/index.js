/**
 * AI Knowledge Base Worker — ТД «Эверест»
 * Llama 3.1 8B + D1 catalog search (58K bearings)
 * Route: /api/ask  (POST {question} | GET ?q=)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};
const JSON_H = { ...CORS, "Content-Type": "application/json; charset=utf-8" };

const SYSTEM = `Ты — опытный специалист по подшипникам компании ТД «Эверест» (Вологда).
Помогаешь клиентам: подобрать подшипник, найти аналог, расшифровать обозначение, понять технические характеристики.
Отвечай кратко и по делу на русском языке. Используй данные из базы если они переданы.

Правила:
- Аналоги только при полном совпадении d/D/B и типа подшипника
- Если аналога нет — пиши "NO DIRECT EQUIV"
- 2RS/DDU = резиновое уплотнение; ZZ = металлический щит
- Зазор C3 = увеличенный; C0 = нормальный
- Указывай конкретные позиции из базы если они есть`;

function ok(d) { return new Response(JSON.stringify({ ok: true, ...d }), { status: 200, headers: JSON_H }); }
function err(m, s = 400) { return new Response(JSON.stringify({ ok: false, error: m }), { status: s, headers: JSON_H }); }

async function search(q, env) {
  const clean = q.replace(/['"`;\\]/g, " ").trim().slice(0, 100);
  const results = [];
  try {
    const r = await env.DB.prepare(
      "SELECT brand, base_number, gost_equiv, d_inner, d_outer, width_mm FROM catalog WHERE base_number LIKE ? OR gost_equiv LIKE ? LIMIT 12"
    ).bind(`%${clean}%`, `%${clean}%`).all();
    if (r.results?.length) results.push(...r.results);
  } catch {}
  try {
    const r = await env.DB.prepare(
      "SELECT data FROM imported_rows WHERE deleted=0 AND base_number LIKE ? LIMIT 5"
    ).bind(`%${clean}%`).all();
    for (const row of r.results || []) {
      try {
        const d = JSON.parse(row.data);
        if (!results.find(x => x.base_number === d.designation))
          results.push({ brand: d.brand, base_number: d.designation, d_inner: d.d, d_outer: d.D, width_mm: d.B });
      } catch {}
    }
  } catch {}
  return results.slice(0, 12);
}

function buildContext(rows) {
  if (!rows.length) return "";
  const lines = rows.map(r =>
    `• ${r.base_number} (${r.brand || "?"})${r.gost_equiv ? ` → ГОСT: ${r.gost_equiv}` : ""}${r.d_inner ? ` | d=${r.d_inner} D=${r.d_outer} B=${r.width_mm}` : ""}`
  );
  return `\nИз базы (${rows.length} позиций):\n${lines.join("\n")}\n`;
}

async function ask(question, env) {
  if (!question?.trim()) return err("question required");
  const rows = await search(question, env);
  const ctx = buildContext(rows);
  const userMsg = ctx ? `${ctx}\nВопрос: ${question}` : question;
  const resp = await env.AI.run(
    "@cf/meta/llama-3.1-8b-instruct",
    { messages: [{ role: "system", content: SYSTEM },{ role: "user", content: userMsg }], max_tokens: 600, temperature: 0.25 },
    { gateway: { id: "b24", skipCache: false, cacheTtl: 3600 } }
  );
  const answer = resp?.response || resp?.result?.response || "Нет ответа от модели";
  return ok({ answer, sources: rows.length, model: "llama-3.1-8b-instruct" });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (path === "/api/ping") return ok({ app: "ai-kb", catalog_rows: 58742, time: new Date().toISOString() });
    if (path === "/api/ask" && method === "POST") {
      let body; try { body = await req.json(); } catch { return err("Invalid JSON"); }
      return ask((body.question || body.message || "").trim(), env);
    }
    if (path === "/api/ask" && method === "GET") {
      return ask((url.searchParams.get("q") || "").trim(), env);
    }
    const ar = await env.ASSETS.fetch(req);
    const h = new Headers(ar.headers);
    ["X-Frame-Options", "Content-Security-Policy"].forEach(k => h.delete(k));
    h.set("Access-Control-Allow-Origin", "*");
    return new Response(ar.body, { status: ar.status, headers: h });
  }
};
