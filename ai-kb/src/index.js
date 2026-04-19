const FRAME_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
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

const CHAT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const EMBED_MODEL = '@cf/baai/bge-m3';
const EMBED_DIMS = 1024;

const MAX_HISTORY = 20;
const MAX_CONTENT = 4000;
const MAX_TOKENS = 900;
const VECTOR_TOPK = 5;
const CATALOG_TOPK = 8;
const CHUNK_CHARS = 1200;
const MAX_DOC_CHARS = 300000;
const CHUNK_OVERLAP = 150;

const AI_SYSTEM = `Ты — инженер-эксперт по подшипникам компании ТД «Эверест» (Вологда).
Отвечай строго по шаблону ниже. Не выдумывай аналоги, не переноси массу между брендами, не подтверждай аналог только по базовому номеру.

Логика: нормализация → разбор ядра/префикса/суффиксов → проверка серии, исполнения, размеров → только потом вывод.

Формат ответа на любой подшипник:

✅ Итог
- Запрос: <исходный запрос>
- Нормализация: <очищенная маркировка с разбором префикс / ядро / суффиксы>
- Тип: <радиальный шариковый | радиально-упорный | конический роликовый | цилиндрический роликовый | сферический роликовый | не определён однозначно>
- Найдено в базе: <да | частично | нет>
- Основной результат: <главный вывод одной строкой>

📋 Данные аналогов

| ГОСТ | ISO | Бренд | Размеры | Масса | Суффиксы | Применение | Примечание |
|------|-----|-------|---------|-------|----------|------------|------------|
| … | … | … | … | … | … | … | … |

🔎 Комментарий
- Что подтверждено: …
- Что не подтверждено: …
- Где нужна проверка: …

Правила таблицы:
- Несколько строк, если несколько подтверждённых вариантов.
- Размеры только если подтверждены (иначе: «НЕ ПОДТВЕРЖДЕНО»).
- Массу указывать только при точном совпадении бренда и исполнения.
- Суффиксы только значимые.
- Применение только если подтверждается типом или базой.
- В «Примечание» только статусы: ПОДТВЕРЖДЕНО / ТРЕБУЕТ_ПРОВЕРКИ / ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ / ОТКЛОНЕНО.

Когда какой статус:
- Совпало только базовое ядро без проверки исполнения → ТРЕБУЕТ_ПРОВЕРКИ.
- Перевод ГОСТ↔ISO без проверки размеров/суффиксов → ТРЕБУЕТ_ПРОВЕРКИ.
- Конфликт по типу/геометрии/исполнению → ОТКЛОНЕНО.
- В базе нет надёжного аналога → ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ.

Если данных недостаточно для подбора, отвечай:

❌ Не найдено в базе

И запроси критичные данные:
- полная маркировка
- размеры d / D / B(H) / T
- нагрузка
- среда и температура
- уплотнения (открытый / Z / 2Z / RS / 2RS)
- зазор
- бренд

Пиши на русском. Никогда не раскрывай источники контекста — не упоминай «каталог», «базу знаний», «RAG», «векторы», «документы из загрузки».`;

function jsonOk(data = {}, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...data }), { status, headers: JSON_HEADERS });
}

function jsonErr(message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: JSON_HEADERS });
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  const got = request.headers.get('X-Admin-Token');
  return typeof got === 'string' && got === expected;
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

async function embed(env, texts) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const resp = await env.AI.run(EMBED_MODEL, { text: arr });
  return resp?.data ?? [];
}

function catalogRowToText(r) {
  const parts = [`Подшипник ${r.base_number}`];
  if (r.brand) parts.push(`бренд ${r.brand}`);
  if (r.type) parts.push(`тип ${r.type}`);
  if (r.d_inner && r.d_outer && r.width_mm) parts.push(`размеры d=${r.d_inner} D=${r.d_outer} B=${r.width_mm}`);
  const analogs = ['skf_analog', 'fag_analog', 'nsk_analog', 'ntn_analog', 'zwz_analog']
    .map(k => r[k])
    .filter(Boolean);
  if (analogs.length) parts.push(`аналоги: ${analogs.join(', ')}`);
  if (r.seal) parts.push(`уплотнение ${r.seal}`);
  if (r.clearance) parts.push(`зазор ${r.clearance}`);
  if (r.price_rub) parts.push(`цена ${r.price_rub} руб`);
  if (r.qty) parts.push(`остаток ${r.qty}`);
  return parts.join(', ');
}

async function searchCatalog(env, query, limit = CATALOG_TOPK) {
  const clean = String(query || '').trim().slice(0, 120);
  if (!clean) return [];
  const tokens = clean.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!tokens.length) return [];
  const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '')}"*`).join(' OR ');
  try {
    const { results } = await env.DB
      .prepare(`SELECT c.* FROM catalog_fts f JOIN catalog c ON c.id = f.rowid
                WHERE catalog_fts MATCH ? LIMIT ?`)
      .bind(ftsQuery, limit)
      .all();
    return results || [];
  } catch {
    const { results } = await env.DB
      .prepare(`SELECT * FROM catalog WHERE base_number LIKE ? LIMIT ?`)
      .bind(`%${tokens[0]}%`, limit)
      .all();
    return results || [];
  }
}

async function searchKnowledge(env, query, topK = VECTOR_TOPK) {
  const vecs = await embed(env, query);
  if (!vecs[0]) return [];
  const vec = Array.isArray(vecs[0]) ? vecs[0] : vecs[0].values || vecs[0];
  const res = await env.VECTORIZE.query(vec, { topK, returnMetadata: 'all' });
  const matches = res?.matches || [];
  return matches.map(m => ({
    id: m.id,
    score: m.score,
    title: m.metadata?.title || '',
    content: m.metadata?.content || '',
    source: m.metadata?.source || 'kb',
  }));
}

function buildContext(catalogRows, kbMatches) {
  const parts = [];
  if (catalogRows.length) {
    parts.push('Позиции из каталога:');
    for (const r of catalogRows) parts.push('- ' + catalogRowToText(r));
  }
  if (kbMatches.length) {
    parts.push('\nФрагменты из базы знаний:');
    for (const m of kbMatches) {
      const snippet = String(m.content).slice(0, 600).replace(/\s+/g, ' ').trim();
      parts.push(`- [${m.title}] ${snippet}`);
    }
  }
  return parts.join('\n');
}

async function handleChat(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }

  const messages = sanitizeMessages(body?.messages);
  if (!messages?.length) return jsonErr('messages required');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return jsonErr('No user message');

  const [catalogRows, kbMatches] = await Promise.all([
    searchCatalog(env, lastUser.content).catch(() => []),
    searchKnowledge(env, lastUser.content).catch(() => []),
  ]);

  const contextText = buildContext(catalogRows, kbMatches);
  const userWithCtx = contextText
    ? `Контекст:\n${contextText}\n\nВопрос: ${lastUser.content}`
    : lastUser.content;

  const aiMessages = [
    { role: 'system', content: AI_SYSTEM },
    ...messages.slice(0, -1),
    { role: 'user', content: userWithCtx },
  ];

  let stream;
  try {
    stream = await env.AI.run(CHAT_MODEL, {
      messages: aiMessages,
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
      stream: true,
    });
  } catch (e) {
    return jsonErr(`AI error: ${e?.message || e}`, 502);
  }

  const headers = {
    ...SSE_HEADERS,
    'X-Sources-Catalog': String(catalogRows.length),
    'X-Sources-Kb': String(kbMatches.length),
  };
  return new Response(stream, { headers });
}

async function handleSearch(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  if (!q.trim()) return jsonErr('q required');
  const [catalog, kb] = await Promise.all([
    searchCatalog(env, q).catch(() => []),
    searchKnowledge(env, q).catch(() => []),
  ]);
  return jsonOk({ catalog, kb });
}

function chunkText(text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + size, clean.length);
    let slice = clean.slice(i, end);
    if (end < clean.length) {
      const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
      if (lastPeriod > size * 0.6) slice = slice.slice(0, lastPeriod + 1);
    }
    chunks.push(slice.trim());
    i += slice.length - overlap;
    if (i <= 0) break;
  }
  return chunks.filter(Boolean);
}

const STRIDE = CHUNK_CHARS - CHUNK_OVERLAP;
function totalChunksCount(len) {
  if (!len) return 0;
  if (len <= CHUNK_CHARS) return 1;
  return Math.ceil((len - CHUNK_OVERLAP) / STRIDE);
}
function sliceChunkAt(text, idx) {
  const start = idx * STRIDE;
  if (start >= text.length) return '';
  const end = Math.min(start + CHUNK_CHARS, text.length);
  return text.slice(start, end).trim();
}

async function handleIngest(request, env) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);

  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }

  const title = String(body?.title || '').trim().slice(0, 200);
  const text = String(body?.text || '').trim().slice(0, MAX_DOC_CHARS);
  const category = String(body?.category || 'docs').slice(0, 50);
  const source = String(body?.source || 'manual').slice(0, 100);
  if (!title || !text) return jsonErr('title and text required');

  const chunks = chunkText(text);
  if (!chunks.length) return jsonErr('no usable text');

  const ins = await env.DB
    .prepare('INSERT INTO knowledge_base (category, title, content, keywords) VALUES (?, ?, ?, ?)')
    .bind(category, title, text, source)
    .run();
  const kbId = ins?.meta?.last_row_id;
  if (!kbId) return jsonErr('Failed to persist document to D1', 500);

  const embeddings = await embed(env, chunks);
  const vectors = chunks.map((c, i) => {
    const rawVec = embeddings[i];
    const values = Array.isArray(rawVec) ? rawVec : rawVec?.values || [];
    return {
      id: `kb-${kbId}-${i}`,
      values,
      metadata: { title, content: c, source, category, kb_id: kbId, chunk: i },
    };
  }).filter(v => v.values.length === EMBED_DIMS);

  if (vectors.length) {
    await env.VECTORIZE.upsert(vectors);
  }

  return jsonOk({ chunks: vectors.length, title, kb_id: kbId });
}

const REINDEX_CHUNKS_PER_CALL = 12;

async function handleReindex(request, env) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);
  const url = new URL(request.url);
  const afterId = Math.max(0, parseInt(url.searchParams.get('after_id') || '0', 10));
  const chunkFrom = Math.max(0, parseInt(url.searchParams.get('chunk_from') || '0', 10));

  const row = chunkFrom > 0
    ? await env.DB.prepare('SELECT id, category, title, content, keywords, LENGTH(content) AS len FROM knowledge_base WHERE id = ?').bind(afterId).first()
    : await env.DB.prepare('SELECT id, category, title, content, keywords, LENGTH(content) AS len FROM knowledge_base WHERE id > ? ORDER BY id LIMIT 1').bind(afterId).first();

  if (!row) {
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge_base').first();
    return jsonOk({ indexed: 0, done: true, total: total?.n ?? 0 });
  }

  const totalChunks = totalChunksCount(row.len);
  const endIdx = Math.min(chunkFrom + REINDEX_CHUNKS_PER_CALL, totalChunks);
  const slice = [];
  for (let i = chunkFrom; i < endIdx; i++) {
    const c = sliceChunkAt(row.content, i);
    if (c) slice.push({ idx: i, text: c });
  }
  if (!slice.length) {
    return jsonOk({ indexed: 0, kb_id: row.id, chunks_total: totalChunks, done: false, next_after_id: row.id, next_chunk_from: 0, row_done: true });
  }

  const embeddings = await embed(env, slice.map(s => s.text));
  const vectors = slice.map((s, k) => {
    const raw = embeddings[k];
    const values = Array.isArray(raw) ? raw : raw?.values || [];
    return {
      id: `kb-${row.id}-${s.idx}`,
      values,
      metadata: {
        title: row.title,
        content: s.text,
        source: row.keywords || 'kb',
        category: row.category,
        kb_id: row.id,
      },
    };
  }).filter(v => v.values.length === EMBED_DIMS);

  if (vectors.length) await env.VECTORIZE.upsert(vectors);

  const nextChunkFrom = endIdx;
  const rowDone = nextChunkFrom >= totalChunks;
  return jsonOk({
    indexed: vectors.length,
    kb_id: row.id,
    title: row.title,
    chunks_total: totalChunks,
    done: false,
    next_after_id: row.id,
    next_chunk_from: rowDone ? 0 : nextChunkFrom,
    row_done: rowDone,
  });
}

async function handleStats(env) {
  try {
    const kb = await env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge_base').first();
    const catalog = await env.DB.prepare('SELECT COUNT(*) AS n FROM catalog').first();
    let vec = null;
    try {
      vec = await env.VECTORIZE.describe();
    } catch {}
    return jsonOk({ knowledge_base: kb?.n ?? 0, catalog: catalog?.n ?? 0, vectorize: vec });
  } catch (e) {
    return jsonErr(`Stats error: ${e.message}`, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: FRAME_HEADERS });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') return handleChat(request, env);
    if (url.pathname === '/api/search' && request.method === 'GET') return handleSearch(request, env);
    if (url.pathname === '/api/ingest' && request.method === 'POST') return handleIngest(request, env);
    if (url.pathname === '/api/reindex' && request.method === 'POST') return handleReindex(request, env);
    if (url.pathname === '/api/stats' && request.method === 'GET') return handleStats(env);
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonOk({ model: CHAT_MODEL, embed: EMBED_MODEL });
    }

    return env.ASSETS.fetch(request);
  },
};
