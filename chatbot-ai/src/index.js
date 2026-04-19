const FRAME_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const JSON_HEADERS = {
  ...FRAME_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
};

const SSE_HEADERS = {
  ...FRAME_HEADERS,
  'Content-Type': 'text/event-stream; charset=utf-8',
  'X-Accel-Buffering': 'no',
};

const AI_SYSTEM = `Ты — опытный специалист по подшипникам компании ТД «Эверест» (Вологда).
Помогаешь клиентам: подобрать подшипник, найти аналог, расшифровать обозначение, понять технические характеристики.
Отвечай кратко и по делу на русском языке.

Правила:
- Аналоги только при полном совпадении d/D/B и типа подшипника
- Если аналога нет — пиши "NO DIRECT EQUIV"
- 2RS/DDU = резиновое уплотнение; ZZ = металлический щит
- Зазор C3 = увеличенный; C0 = нормальный`;

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MAX_HISTORY = 30;
const MAX_CONTENT = 4000;
const MAX_TOKENS = 800;

function jsonErr(message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: JSON_HEADERS,
  });
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const trimmed = raw.slice(-MAX_HISTORY);
  const out = [];
  for (const m of trimmed) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null;
    if (!role) continue;
    const content = String(m.content ?? '').slice(0, MAX_CONTENT);
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonErr('Invalid JSON', 400);
  }

  const messages = sanitizeMessages(body?.messages);
  if (!messages || messages.length === 0) {
    return jsonErr('messages must be a non-empty array', 400);
  }
  if (messages[messages.length - 1].role !== 'user') {
    return jsonErr('Last message must be from user', 400);
  }

  const aiMessages = [{ role: 'system', content: AI_SYSTEM }, ...messages];

  let aiStream;
  try {
    aiStream = await env.AI.run(MODEL, {
      messages: aiMessages,
      max_tokens: MAX_TOKENS,
      temperature: 0.25,
      stream: true,
    });
  } catch (e) {
    return jsonErr(`AI error: ${e?.message || e}`, 502);
  }

  return new Response(aiStream, { headers: SSE_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: FRAME_HEADERS });
    }

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') return jsonErr('Method not allowed', 405);
      return handleChat(request, env);
    }

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true, model: MODEL }), { headers: JSON_HEADERS });
    }

    return env.ASSETS.fetch(request);
  },
};
