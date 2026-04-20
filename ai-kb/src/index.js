// ai-kb/src/index.js
// Worker: AI-ассистент по базе знаний ТД «Эверест»
// D1: baza | R2: vedro | Vectorize: ai-kb-index | AI: Workers AI

import {
  handleAdminFilesUpload,
  handleAdminFilesList,
  handleAdminFilesDelete,
  handleAdminStorageStats,
} from './files.js';
import { checkRate, bucketForRequest, rateLimitedResponse } from './ratelimit.js';
import { extractDimensions, extractBearingTypeHint, findAnalogsByDimensions, geoRowToText } from './bearings.js';
import {
  validateCredentials, hashPassword, safeEqHex, genSalt, newUserId,
  createSessionToken, revokeToken, resolveUser, extractBearer,
} from './auth.js';

const FRAME_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
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

const CHAT_MODEL  = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const EMBED_MODEL = '@cf/baai/bge-m3';
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const EMBED_DIMS  = 1024;

const MAX_HISTORY          = 20;
const MAX_CONTENT          = 4000;
const MAX_TOKENS           = 900;
const MAX_ATTACHMENT_TEXT  = 12000;
const MAX_IMAGES           = 3;
const VECTOR_TOPK          = 5;
const CATALOG_TOPK         = 6;
const CHUNK_CHARS          = 1200;
const CHUNK_OVERLAP        = 150;
const MAX_DOC_CHARS        = 300_000;
const REINDEX_CHUNKS_PER_CALL = 12;

// ============================================================
// AI System prompt
// ============================================================
const AI_SYSTEM = `Ты — инженер-эксперт по подшипникам компании ТД «Эверест» (Вологда).
Отвечай строго по шаблону ниже. Не выдумывай бренд-специфичные аналоги и не переноси массу между брендами.

Логика подбора аналога:
1. Нормализуй обозначение: префикс / ядро / суффиксы.
2. Определи ТИП по серии (см. таблицу ниже).
3. Определи СИСТЕМУ запроса: ISO или ГОСТ (по правилам ниже).
4. Возьми справочные размеры по ISO 15 / ISO 355.
5. КРИТИЧНО: аналог обязан быть того же ТИПА, что и запрос. Шариковый подшипник НИКОГДА не аналог роликового и наоборот, даже если совпадают размеры d×D×B.
6. КРИТИЧНО: НАПРАВЛЕНИЕ перевода — ОДНОНАПРАВЛЕННОЕ. Никогда не возвращай аналог в той же системе, что и запрос.
   - Запрос в ISO → в ответе только ГОСТ-обозначения. ISO-варианты того же подшипника (например, 6311 → 6311/C3, 6311-Z, 6311-2RS) НЕ являются аналогом и в таблицу НЕ попадают.
   - Запрос в ГОСТ → в ответе только ISO-обозначения. ГОСТ-варианты того же подшипника (например, 180205 → 180205АС17, 180205С9) НЕ являются аналогом и в таблицу НЕ попадают.
   - Если в системе запроса есть варианты исполнения (С1, С9, АС17, /C3, /P6, -2RS), упомяни их одной строкой в комментарии, но в таблицу не дублируй.
7. Подставляй обозначения только из таблицы соответствий ниже — не выдумывай.

ISO-обозначения (ISO 15 / ISO 355):
- 6xxx (60, 62, 63, 64) — радиальный шариковый однорядный
- 16xxx — радиальный шариковый узкой серии
- 7xxx (70x, 72x, 73x) — радиально-упорный шариковый однорядный
- 22xxx, 23xxx — сферический роликовый двухрядный
- 30xxx, 31xxx, 32xxx (5-значные) — конический роликовый
- NU, NJ, N, NF, NUP — цилиндрический роликовый однорядный
- 51xxx–54xxx — упорный шариковый
- 80xxx, 81xxx — упорный роликовый

ГОСТ-обозначения (ГОСТ 3189-89):
- 4–6 значные начиная с 0/1/2/3/4/5/6/7/8 — основной формат ГОСТ (например 180205, 36209, 7305)
- 4-значные 7xxx — конический роликовый по ГОСТ 333
- 4-значные 8xxx — упорный шариковый
- При двусмысленности (4 цифры на 7 или 8) — уточни у пользователя

Как отличить систему запроса (правила применяй сверху вниз — побеждает первое совпавшее):
- Префикс NU/NJ/N/NF/NUP, цифры 22xxx/23xxx/30xxx/31xxx/32xxx (5 цифр), 16xxx, 51xxx–54xxx → точно ISO.
- 4–5 цифр 6xxx без префикса (6205, 6311, 62307) → ISO. (4-значные 6xxx ГОСТа практически не встречаются в запросах — относи к ISO.)
- 6 цифр без буквенного префикса (180205, 466714, 664706) → точно ГОСТ.
- 5 цифр 80xxx/81xxx — двусмысленно: ISO это упорный роликовый (81102, 81105…), а ГОСТ 80xxx/81xxx по кросс-таблице ниже отображается в шариковый 6xxxZ/6xxxZZ. Если пользователь русскоязычный и не уточнил производителя — считай ГОСТ, но в комментарии явно попроси подтвердить.
- 4 цифры в диапазоне 7xxx/8xxx → уточни у пользователя (двусмысленно).

Кросс-таблица ГОСТ ↔ ISO:
- 0xxxxx → 6xxx | 50xxx → 6xxxN | 60xxx → 6xxxZ | 80xxx → 6xxxZZ
- 180xxx → 6xxx-2RS | 70-xxx → 6xxx/C3 | 76-xxx → 6xxx/P6
- 36xxxx → 7xxxC | 46xxxx → 7xxxAC | 66xxxx → 7xxxB
- 32xxxx → NUxxxx | 12xxxx → NJxxxx | 42xxxx → NUPxxxx
- 7xxx (4-зн.) → 30xxx

Правила: размеры d×D×B — по ISO 15, статус ПОДТВЕРЖДЕНО. Массу — только при точном совпадении бренда и исполнения.

Формат ответа:
✅ Итог
- Запрос: <дословно>
- Система запроса: <ISO | ГОСТ>
- Нормализация: <префикс / ядро / суффиксы>
- Тип: <тип>
- Найдено в базе: <да | частично | нет>
- Основной результат: <одна фраза>

📋 Аналоги (0–3 строки, в системе ПРОТИВОПОЛОЖНОЙ запросу)
| Аналог | Бренд | Размеры | Масса | Суффиксы | Применение | Примечание |

(если запрос в ISO — в колонке «Аналог» только ГОСТ-обозначения; если в ГОСТ — только ISO. Не дублируй варианты той же системы. Если подтверждённого аналога нет — таблицу оставь пустой и поставь статус ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ, НЕ ВЫДУМЫВАЙ строки ради формата.)

🔎 Комментарий
- Что подтверждено: …
- Что не подтверждено: …
- Варианты исполнения в системе запроса (если есть): …
- Где нужна проверка: …

Статусы: ПОДТВЕРЖДЕНО | ТРЕБУЕТ_ПРОВЕРКИ | ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ | ОТКЛОНЕНО

КОММЕРЧЕСКАЯ ГРАНИЦА: наличие, цена, поставка — «Требует подтверждения менеджером».`;

// ============================================================
// Helpers
// ============================================================
function jsonOk(data, extra = {}) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200, headers: { ...JSON_HEADERS, ...extra },
  });
}

function jsonErr(message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status, headers: JSON_HEADERS,
  });
}

// Constant-time string compare — same primitive as the root worker's
// safeEqual. We deliberately don't use crypto.subtle.timingSafeEqual
// because it's not portable across Workers runtime versions and adds
// no benefit for ASCII tokens at this length. Manual XOR over codeUnits
// is plenty fast and runs in O(n) regardless of mismatch position.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  const got = request.headers.get('X-Admin-Token') || '';
  return safeEqual(got, expected);
}

// ============================================================
// /api/auth — simple username/password auth
// ============================================================

// Self-heal for the auth + chat_sessions.client_id schema — same pattern as
// handleSetSettings uses for the `settings` table. If migrations 0006 /
// 0007 haven't been applied on a deployed worker, users hit "no such table:
// users" or "no such column: client_id" the moment they try to sign in or
// chat. Creating the missing pieces lazily on first use unblocks them
// without waiting for an out-of-band migration run. Still ship the
// migration files for fresh D1 bootstraps — never rely solely on this.
let authTablesReady = false;
async function ensureAuthTables(env) {
  if (authTablesReady) return;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS users (
           id             TEXT PRIMARY KEY,
           username       TEXT NOT NULL UNIQUE,
           password_hash  TEXT NOT NULL,
           password_salt  TEXT NOT NULL,
           created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
         )`
      ),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)'),
      env.DB.prepare(
        // FK mirrors migration 0007_users_auth.sql. D1 ignores FK constraints
        // unless PRAGMA foreign_keys = ON is set for the connection — but we
        // still declare it so the two schema sources stay in lockstep (any
        // tooling that introspects table DDL sees the same structure).
        `CREATE TABLE IF NOT EXISTS user_sessions (
           token       TEXT PRIMARY KEY,
           user_id     TEXT NOT NULL,
           created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
           expires_at  DATETIME NOT NULL,
           FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
         )`
      ),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_sessions_exp  ON user_sessions (expires_at)'),
    ]);
    // Separately: chat_sessions.client_id (migration 0006). ALTER TABLE ADD
    // COLUMN is not idempotent, so probe via PRAGMA table_info first.
    try {
      const info = await env.DB.prepare('PRAGMA table_info(chat_sessions)').all();
      const has = (info.results || []).some(r => r.name === 'client_id');
      if (!has) {
        await env.DB.prepare('ALTER TABLE chat_sessions ADD COLUMN client_id TEXT').run();
        await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_client ON chat_sessions (client_id, updated_at DESC)').run();
      }
    } catch { /* chat_sessions might not exist yet on a wholly fresh DB */ }
    authTablesReady = true;
  } catch { /* best-effort; next call retries */ }
}
async function handleAuthRegister(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }
  const v = validateCredentials(body);
  if (v.error) return jsonErr(v.error, 400);
  await ensureAuthTables(env);
  try {
    const existing = await env.DB
      .prepare('SELECT id FROM users WHERE username = ?').bind(v.username).first();
    if (existing) return jsonErr('Имя уже занято', 409);
    const salt = genSalt();
    const hash = await hashPassword(v.password, salt);
    const userId = newUserId();
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, password_salt) VALUES (?, ?, ?, ?)'
    ).bind(userId, v.username, hash, salt).run();
    const { token, expires_at } = await createSessionToken(env, userId);
    return jsonOk({ token, username: v.username, expires_at });
  } catch (e) {
    return jsonErr('Registration failed: ' + (e?.message || e), 500);
  }
}

async function handleAuthLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }
  const v = validateCredentials(body);
  if (v.error) return jsonErr(v.error, 400);
  await ensureAuthTables(env);
  try {
    const row = await env.DB.prepare(
      'SELECT id, password_hash, password_salt FROM users WHERE username = ?'
    ).bind(v.username).first();
    // Always run PBKDF2 even if user is missing, so response time doesn't
    // tell an attacker whether the username exists.
    const salt = row?.password_salt || '0123456789abcdef0123456789abcdef';
    const candidate = await hashPassword(v.password, salt);
    const ok = !!row && safeEqHex(candidate, row.password_hash);
    if (!ok) return jsonErr('Неверное имя или пароль', 401);
    const { token, expires_at } = await createSessionToken(env, row.id);
    return jsonOk({ token, username: v.username, expires_at });
  } catch (e) {
    return jsonErr('Login failed: ' + (e?.message || e), 500);
  }
}

async function handleAuthLogout(request, env) {
  await revokeToken(env, extractBearer(request));
  return jsonOk({ logout: true });
}

async function handleAuthMe(request, env) {
  const user = await resolveUser(request, env);
  if (!user) return jsonErr('Unauthorized', 401);
  return jsonOk({ username: user.username });
}

// ============================================================
// Settings (D1 key-value)
// ============================================================
const SETTING_KEYS = new Set([
  'system_prompt',
  'temperature',
  'max_tokens',
  'catalog_topk',
  'vector_topk',
]);

// Schema lives in ai-kb/migrations/0005_settings.sql — no lazy DDL here.
// Read errors fall back to compile-time defaults so chat keeps working
// even if the migration hasn't been applied yet.
async function getSetting(env, key, fallback) {
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

// setSetting/deleteSetting helpers removed — handleSetSettings inlines
// the same SQL via env.DB.batch(). Restore them here only if a second
// call site appears.

async function handleGetSettings(env) {
  // Fall back to compile-time defaults if the settings table is missing
  // (migration 0005 not applied yet) or D1 is briefly unreachable. Match
  // what getSetting() does on hot chat path so /api/settings can't be
  // the only thing that 500s while chat keeps working.
  let results = [];
  try {
    const res = await env.DB.prepare('SELECT key, value, updated_at FROM settings').all();
    results = res.results || [];
  } catch { /* fall through with defaults */ }
  const out = {
    system_prompt: AI_SYSTEM,
    temperature: String(0.2),
    max_tokens: String(MAX_TOKENS),
    catalog_topk: String(CATALOG_TOPK),
    vector_topk: String(VECTOR_TOPK),
    _overrides: {},
  };
  for (const r of results || []) {
    if (SETTING_KEYS.has(r.key)) {
      out[r.key] = r.value;
      out._overrides[r.key] = { updated_at: r.updated_at };
    }
  }
  return jsonOk({ settings: out });
}

async function handleSetSettings(request, env) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);
  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }
  const updates = body?.settings || {};

  const saved = [];
  const statements = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!SETTING_KEYS.has(k)) continue;
    if (v == null || String(v).trim() === '') {
      statements.push(env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(k));
      saved.push({ key: k, cleared: true });
    } else {
      const val = String(v).slice(0, 60000);
      statements.push(
        env.DB
          .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
          .bind(k, val)
      );
      saved.push({ key: k, updated: true });
    }
  }
  if (statements.length) {
    try {
      await env.DB.batch(statements);
    } catch (e) {
      // Self-heal: on a fresh/staging D1 where 0005_settings hasn't been
      // applied yet, the table is missing. Create it lazily this ONE time
      // and replay the batch. Reads use getSetting()'s try/catch fallback
      // to defaults, but writes must actually persist — returning 500
      // here would silently break the admin panel.
      if (String(e?.message || '').includes('no such table')) {
        await env.DB
          .prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER DEFAULT (unixepoch()))')
          .run();
        await env.DB.batch(statements);
      } else {
        throw e;
      }
    }
  }
  return jsonOk({ saved });
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.slice(-MAX_HISTORY).reduce((acc, m) => {
    if (!m || typeof m !== 'object') return acc;
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null;
    if (!role) return acc;
    const content = String(m.content ?? '').slice(0, MAX_CONTENT);
    if (!content.trim()) return acc;
    acc.push({ role, content });
    return acc;
  }, []);
}

// ============================================================
// Embeddings
// ============================================================
async function embed(env, texts) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const resp = await env.AI.run(EMBED_MODEL, { text: arr });
  return resp?.data ?? [];
}

// ============================================================
// Catalog search (FTS5 + fallback LIKE)
// ============================================================
function catalogRowToText(r) {
  const parts = [`Подшипник ${r.base_number}`];
  if (r.brand)   parts.push(`бренд ${r.brand}`);
  if (r.type)    parts.push(`тип ${r.type}`);
  if (r.d_inner && r.d_outer && r.width_mm)
    parts.push(`размеры d=${r.d_inner} D=${r.d_outer} B=${r.width_mm}`);
  const analogs = ['skf_analog','fag_analog','nsk_analog','ntn_analog','zwz_analog']
    .map(k => r[k]).filter(Boolean);
  if (analogs.length) parts.push(`аналоги: ${analogs.join(', ')}`);
  if (r.seal)      parts.push(`уплотнение ${r.seal}`);
  if (r.clearance) parts.push(`зазор ${r.clearance}`);
  if (r.price_rub) parts.push(`цена ${r.price_rub} руб`);
  if (r.qty)       parts.push(`остаток ${r.qty}`);
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
      .bind(ftsQuery, limit).all();
    if (results?.length) return results;
  } catch { /* FTS может не существовать */ }
  const { results } = await env.DB
    .prepare(`SELECT * FROM catalog WHERE base_number LIKE ? LIMIT ?`)
    .bind(`%${tokens[0]}%`, limit).all();
  return results || [];
}

// ============================================================
// Knowledge Base vector search
// ============================================================
async function searchKnowledge(env, query, topK = VECTOR_TOPK) {
  const vecs = await embed(env, query);
  if (!vecs[0]) return [];
  const vec = Array.isArray(vecs[0]) ? vecs[0] : vecs[0].values || vecs[0];
  const res = await env.VECTORIZE.query(vec, { topK, returnMetadata: 'all' });
  return (res?.matches || []).map(m => ({
    id:      m.id,
    score:   m.score,
    title:   m.metadata?.title   || '',
    content: m.metadata?.content || '',
    source:  m.metadata?.source  || 'kb',
  }));
}

// ============================================================
// Context builder
// ============================================================
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

// ============================================================
// Vision
// ============================================================
function dataUrlToBytes(dataUrl) {
  const m = /^data:[^;]+;base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

async function describeImage(env, image, userQuery) {
  const bytes = dataUrlToBytes(image?.dataUrl);
  if (!bytes?.length) return '';
  try {
    const resp = await env.AI.run(VISION_MODEL, {
      image: Array.from(bytes),
      prompt: `Ты — эксперт по подшипникам. Опиши изображение: маркировка, бренд, размеры, тип, состояние. Контекст: ${String(userQuery || '').slice(0, 200)}`,
      max_tokens: 300,
    });
    return String(resp?.description ?? resp?.response ?? '').trim().slice(0, 1200);
  } catch { return ''; }
}

// ============================================================
// Session helpers (D1)
// ============================================================
// Returns sessionId on success, 'forbidden' on ownership mismatch, null on
// DB error / missing sessionId. Admin bypasses the ownership check.
async function ensureSession(env, sessionId, clientId, isAdmin) {
  if (!sessionId) return null;
  try {
    const existing = await env.DB
      .prepare('SELECT id, client_id FROM chat_sessions WHERE id = ?')
      .bind(sessionId).first();
    if (!existing) {
      await env.DB
        .prepare('INSERT INTO chat_sessions (id, title, client_id) VALUES (?, ?, ?)')
        .bind(sessionId, '', clientId || null).run();
    } else if (!existing.client_id && clientId) {
      // Back-fill client_id on a legacy row so it shows up in the user's
      // sidebar from now on.
      await env.DB
        .prepare('UPDATE chat_sessions SET client_id = ? WHERE id = ? AND client_id IS NULL')
        .bind(clientId, sessionId).run();
    } else if (existing.client_id && existing.client_id !== clientId && !isAdmin) {
      // Ownership mismatch: session is owned by another browser and the
      // caller is not admin. Block the write to prevent session-UUID hijack.
      return 'forbidden';
    }
    return sessionId;
  } catch { return null; }
}

async function saveMessages(env, sessionId, userContent, assistantContent, sources) {
  if (!sessionId) return;
  try {
    const title = userContent.slice(0, 80).replace(/\s+/g, ' ').trim();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO chat_messages (session_id, role, content, sources) VALUES (?, ?, ?, ?)'
      ).bind(sessionId, 'user', userContent, 0),
      env.DB.prepare(
        'INSERT INTO chat_messages (session_id, role, content, sources) VALUES (?, ?, ?, ?)'
      ).bind(sessionId, 'assistant', assistantContent, sources),
      env.DB.prepare(
        `UPDATE chat_sessions SET
           updated_at = datetime('now'),
           message_count = message_count + 2,
           title = CASE WHEN title = '' THEN ? ELSE title END
         WHERE id = ?`
      ).bind(title, sessionId),
    ]);
  } catch { /* не критично */ }
}

async function logQuery(env, sessionId, question, answerLen, sourcesCat, sourcesKb, model, latencyMs, error) {
  try {
    await env.DB
      .prepare(`INSERT INTO query_log
        (session_id, question, answer_len, sources_kb, sources_cat, model, latency_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(sessionId || null, question, answerLen, sourcesKb, sourcesCat, model, latencyMs, error || null)
      .run();
  } catch { /* не критично */ }
}

// ============================================================
// /api/chat — основной endpoint (SSE стриминг)
// ============================================================
async function handleChat(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }

  const messages = sanitizeMessages(body?.messages);
  if (!messages?.length) return jsonErr('messages required');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return jsonErr('No user message');

  const sessionId      = String(body?.session_id || '').slice(0, 64) || null;
  const isAdmin        = requireAdmin(request, env);
  const user           = isAdmin ? null : await resolveUser(request, env);
  if (!isAdmin && !user) return jsonErr('Unauthorized', 401);
  // Identity used to own chat_sessions rows. Authed user → their user.id;
  // admin via X-Admin-Token → null (admin writes don't claim a client_id).
  const clientId       = user?.id || null;
  const attachmentText = String(body?.attachment_text || '').slice(0, MAX_ATTACHMENT_TEXT);
  const rawImages      = Array.isArray(body?.images) ? body.images : [];
  const images         = rawImages.slice(0, MAX_IMAGES).filter(x => x?.dataUrl);

  const t0 = Date.now();
  const searchQuery = lastUser.content;

  // Pull all overrides in a single D1 query. Use ?? so explicit 0 values
  // (e.g. catalog_topk=0 to disable the catalog leg) aren't swallowed by ||.
  let sRows = [];
  try {

    const res = await env.DB.prepare('SELECT key, value FROM settings').all();
    sRows = res.results || [];
  } catch { /* settings table unreachable — fall back to constants */ }
  const sMap = Object.fromEntries(sRows.map(r => [r.key, r.value]));

  const sysPrompt   = sMap.system_prompt || AI_SYSTEM;
  const tempNum     = parseFloat(sMap.temperature ?? '0.2');
  const temperature = Math.max(0, Math.min(1.5, Number.isFinite(tempNum) ? tempNum : 0.2));
  const maxTokNum   = parseInt(sMap.max_tokens ?? MAX_TOKENS, 10);
  const maxTokens   = Math.max(64, Math.min(2000, Number.isFinite(maxTokNum) ? maxTokNum : MAX_TOKENS));
  const catalogNum  = parseInt(sMap.catalog_topk ?? CATALOG_TOPK, 10);
  const catalogTopK = Math.max(0, Math.min(20, Number.isFinite(catalogNum) ? catalogNum : CATALOG_TOPK));
  const vectorNum   = parseInt(sMap.vector_topk ?? VECTOR_TOPK, 10);
  const vectorTopK  = Math.max(0, Math.min(20, Number.isFinite(vectorNum) ? vectorNum : VECTOR_TOPK));

  // If the user wrote dimensions like "25x52x15" AND a type hint
  // (e.g. NU205 / 6205 / 32205), do a strict geometric lookup in
  // parallel with FTS+Vectorize. Type is required because the same
  // d×D×B can belong to ball, cylindrical roller, tapered, etc. — geo
  // alone would let LLM mix incompatible bearings into the "точные
  // аналоги" block. No hint → no geo leg.
  const dims = extractDimensions(searchQuery);
  const typeHint = extractBearingTypeHint(searchQuery);

  const [catalogRows, kbMatches, geoRows] = await Promise.all([
    catalogTopK > 0 ? searchCatalog(env, searchQuery, catalogTopK).catch(() => []) : Promise.resolve([]),
    vectorTopK > 0 ? searchKnowledge(env, searchQuery, vectorTopK).catch(() => []) : Promise.resolve([]),
    (dims && typeHint)
      ? findAnalogsByDimensions(env.DB, dims.d_inner, dims.d_outer, dims.width, typeHint).catch(() => [])
      : Promise.resolve([]),
  ]);

  const imageDescs = [];
  for (const img of images) {
    const desc = await describeImage(env, img, searchQuery);
    if (desc) imageDescs.push(`📷 ${String(img.name || 'image').slice(0, 80)}: ${desc}`);
  }

  const ctx = buildContext(catalogRows, kbMatches);
  const parts = [];
  if (ctx)               parts.push('Контекст:\n' + ctx);
  if (geoRows.length) {
    const lines = geoRows.map(r => '- ' + geoRowToText(r));
    parts.push(`Точные геометрические аналоги (d=${dims.d_inner} D=${dims.d_outer} B=${dims.width}):\n${lines.join('\n')}`);
  }
  if (attachmentText)    parts.push('Прикреплённые документы:\n' + attachmentText);
  if (imageDescs.length) parts.push('Описание изображений:\n' + imageDescs.join('\n'));
  parts.push('Вопрос: ' + searchQuery);

  const aiMessages = [
    { role: 'system', content: sysPrompt },
    ...messages.slice(0, -1),
    { role: 'user', content: parts.join('\n\n') },
  ];

  if (sessionId) {
    const sid = await ensureSession(env, sessionId, clientId, isAdmin);
    if (sid === 'forbidden') return jsonErr('Forbidden', 403);
  }

  let stream;
  try {
    stream = await env.AI.run(CHAT_MODEL, {
      messages: aiMessages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    });
  } catch (e) {
    await logQuery(env, sessionId, searchQuery, 0, catalogRows.length + geoRows.length, kbMatches.length, CHAT_MODEL, Date.now() - t0, e?.message);
    return jsonErr(`AI error: ${e?.message || e}`, 502);
  }

  // Перехватываем поток для записи в историю
  const [streamA, streamB] = stream.tee();
  const sources = catalogRows.length + kbMatches.length + geoRows.length;

  // Асинхронно собираем ответ и пишем в D1.
  // ctx.waitUntil держит изолят живым до завершения записи — без него
  // Workers может завершить воркер сразу после закрытия SSE-потока и
  // потерять историю сообщений и query_log.
  const persist = (async () => {
    try {
      const reader = streamB.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        // SSE: data: {"response":"..."}
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try { full += JSON.parse(raw)?.response ?? ''; } catch { /* skip */ }
        }
      }
      await saveMessages(env, sessionId, searchQuery, full, sources);
      // Roll geo-hits into the catalog count for query_log: the table has
      // sourcesCat/sourcesKb columns only, and geo IS catalog data
      // (just selected by exact dimension match). The precise per-leg
      // breakdown still ships in the X-Sources-* response headers.
      await logQuery(env, sessionId, searchQuery, full.length, catalogRows.length + geoRows.length, kbMatches.length, CHAT_MODEL, Date.now() - t0, null);
    } catch { /* не критично */ }
  })();
  if (ctx?.waitUntil) ctx.waitUntil(persist);

  return new Response(streamA, {
    headers: {
      ...SSE_HEADERS,
      'X-Sources-Catalog': String(catalogRows.length),
      'X-Sources-Kb':      String(kbMatches.length),
      'X-Sources-Geo':     String(geoRows.length),
      'X-Images-Described': String(imageDescs.length),
    },
  });
}

// ============================================================
// /api/search — поиск без AI
// ============================================================
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

// ============================================================
// /api/sessions — история сессий
// ============================================================
async function handleSessions(request, env) {
  const url = new URL(request.url);

  const isAdmin = requireAdmin(request, env);
  // Auth-gated: non-admin must present a valid Bearer token. The caller's
  // user.id is the only owner id that matters — ?client_id= query is ignored
  // except for admin inspection.
  const user = isAdmin ? null : await resolveUser(request, env);
  if (!isAdmin && !user) return jsonErr('Unauthorized', 401);
  const clientId = user?.id || null;
  const adminClientFilter = isAdmin
    ? (String(url.searchParams.get('client_id') || '').slice(0, 64) || null)
    : null;

  // GET /api/sessions — список. Автор — только свои; админ без фильтра — все.
  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);
    const filterClient = clientId || adminClientFilter;
    const q = (isAdmin && !filterClient)
      ? env.DB.prepare('SELECT id, title, message_count, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?').bind(limit, offset)
      : env.DB.prepare('SELECT id, title, message_count, created_at, updated_at FROM chat_sessions WHERE client_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?').bind(filterClient, limit, offset);
    const { results } = await q.all();
    return jsonOk({ sessions: results || [] });
  }

  // GET /api/sessions/:id/messages — owner-check по user.id.
  const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (m && request.method === 'GET') {
    const sid = m[1];
    if (!isAdmin) {
      const row = await env.DB.prepare('SELECT client_id FROM chat_sessions WHERE id = ?').bind(sid).first();
      if (!row) return jsonErr('Session not found', 404);
      if (row.client_id !== clientId) return jsonErr('Forbidden', 403);
    }
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const { results } = await env.DB
      .prepare('SELECT id, role, content, sources, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?')
      .bind(sid, limit).all();
    return jsonOk({ messages: results || [] });
  }

  // DELETE /api/sessions/:id — owner или admin.
  const del = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (del && request.method === 'DELETE') {
    const sid = del[1];
    if (!isAdmin) {
      const row = await env.DB.prepare('SELECT client_id FROM chat_sessions WHERE id = ?').bind(sid).first();
      if (!row) return jsonErr('Session not found', 404);
      if (row.client_id !== clientId) return jsonErr('Forbidden', 403);
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM chat_messages WHERE session_id = ?').bind(sid),
      env.DB.prepare('DELETE FROM chat_sessions WHERE id = ?').bind(sid),
    ]);
    return jsonOk({ deleted: sid });
  }

  return jsonErr('Not found', 404);
}

// ============================================================
// /api/ingest — загрузка документа в KB
// ============================================================
async function handleIngest(request, env) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);
  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }

  const title    = String(body?.title    || '').trim().slice(0, 200);
  const text     = String(body?.text     || '').trim().slice(0, MAX_DOC_CHARS);
  const category = String(body?.category || 'docs').slice(0, 50);
  const source   = String(body?.source   || 'manual').slice(0, 100);
  if (!title || !text) return jsonErr('title and text required');

  const chunks = chunkText(text);
  if (!chunks.length) return jsonErr('no usable text');

  const ins = await env.DB
    .prepare('INSERT INTO knowledge_base (category, title, content, keywords) VALUES (?, ?, ?, ?)')
    .bind(category, title, text, source).run();
  const kbId = ins?.meta?.last_row_id;
  if (!kbId) return jsonErr('Failed to persist document', 500);

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

  if (vectors.length) await env.VECTORIZE.upsert(vectors);
  return jsonOk({ chunks: vectors.length, title, kb_id: kbId });
}

// ============================================================
// /api/reindex — переиндексация KB в Vectorize
// ============================================================
const STRIDE = CHUNK_CHARS - CHUNK_OVERLAP;
function totalChunksCount(len) {
  if (!len) return 0;
  return len <= CHUNK_CHARS ? 1 : Math.ceil((len - CHUNK_OVERLAP) / STRIDE);
}
function sliceChunkAt(text, idx) {
  const start = idx * STRIDE;
  if (start >= text.length) return '';
  return text.slice(start, Math.min(start + CHUNK_CHARS, text.length)).trim();
}

async function handleReindex(request, env) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);
  const url      = new URL(request.url);
  const afterId  = Math.max(0, parseInt(url.searchParams.get('after_id')   || '0', 10));
  const chunkFrom= Math.max(0, parseInt(url.searchParams.get('chunk_from') || '0', 10));

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
    const raw    = embeddings[k];
    const values = Array.isArray(raw) ? raw : raw?.values || [];
    return {
      id: `kb-${row.id}-${s.idx}`,
      values,
      metadata: { title: row.title, content: s.text, source: row.keywords || 'kb', category: row.category, kb_id: row.id },
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

// ============================================================
// /api/stats
// ============================================================
async function handleStats(env) {
  try {
    const [kb, catalog, qlog, sessions] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge_base').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM catalog').first().catch(() => ({ n: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS n FROM query_log').first().catch(() => ({ n: 0 })),
      env.DB.prepare('SELECT COUNT(*) AS n FROM chat_sessions').first().catch(() => ({ n: 0 })),
    ]);
    let vec = null;
    try { vec = await env.VECTORIZE.describe(); } catch { /* Vectorize может быть недоступен */ }
    return jsonOk({
      knowledge_base: kb?.n  ?? 0,
      catalog:        catalog?.n ?? 0,
      query_log:      qlog?.n ?? 0,
      sessions:       sessions?.n ?? 0,
      vectorize:      vec,
    });
  } catch (e) {
    return jsonErr(`Stats error: ${e.message}`, 500);
  }
}

// ============================================================
// Chunking
// ============================================================
function chunkText(text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    const end   = Math.min(i + size, clean.length);
    let slice   = clean.slice(i, end);
    if (end < clean.length) {
      const last = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
      if (last > size * 0.6) slice = slice.slice(0, last + 1);
    }
    chunks.push(slice.trim());
    i += slice.length - overlap;
    if (i <= 0) break;
  }
  return chunks.filter(Boolean);
}

// ============================================================
// Router
// ============================================================
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: FRAME_HEADERS });

    if (path === '/api/chat'   && method === 'POST') {
      // Chat burns 70B inference + bge-m3 embed + maybe vision per turn,
      // so each request is expensive. 30/min is ~1 per 2s — more than
      // enough for humans, stops scripts cold. Admins bypass for testing.
      if (!requireAdmin(request, env)) {
        const rl = await checkRate(env.DB, bucketForRequest(request, 'chat'), 30, 60);
        if (!rl.allowed) return rateLimitedResponse(rl);
      }
      return handleChat(request, env, ctx);
    }

    // /api/auth — register/login/logout/me. Rate-limit register+login
    // aggressively to slow down credential-stuffing and bot signups.
    if (path === '/api/auth/register' && method === 'POST') {
      const rl = await checkRate(env.DB, bucketForRequest(request, 'auth-reg'), 5, 300);
      if (!rl.allowed) return rateLimitedResponse(rl);
      return handleAuthRegister(request, env);
    }
    if (path === '/api/auth/login' && method === 'POST') {
      const rl = await checkRate(env.DB, bucketForRequest(request, 'auth-login'), 10, 60);
      if (!rl.allowed) return rateLimitedResponse(rl);
      return handleAuthLogin(request, env);
    }
    if (path === '/api/auth/logout' && method === 'POST') return handleAuthLogout(request, env);
    if (path === '/api/auth/me'     && method === 'GET')  return handleAuthMe(request, env);
    if (path === '/api/search' && method === 'GET')  return handleSearch(request, env);
    if (path === '/api/ingest' && method === 'POST') return handleIngest(request, env);
    if (path === '/api/reindex'&& method === 'POST') return handleReindex(request, env);
    if (path === '/api/stats'  && method === 'GET')  return handleStats(env);
    if (path === '/api/health' && method === 'GET')  return jsonOk({ model: CHAT_MODEL, embed: EMBED_MODEL });

    // Settings (admin-editable bot prompt + tuning params)
    if (path === '/api/settings' && method === 'GET')  return handleGetSettings(env);
    if (path === '/api/settings' && method === 'POST') return handleSetSettings(request, env);

    // Admin: file registry (uploads originals to R2, metadata in D1).
    // Needs migration 0002_files_rules_catalog.sql.
    const helpers = { jsonOk, jsonErr, requireAdmin };
    if (path === '/api/admin/files/upload' && method === 'POST') return handleAdminFilesUpload(request, env, helpers);
    if (path === '/api/admin/files'        && method === 'GET')  return handleAdminFilesList(request, env, helpers);
    if (path === '/api/admin/storage/stats' && method === 'GET') return handleAdminStorageStats(request, env, helpers);
    const fileDel = path.match(/^\/api\/admin\/files\/(\d+)$/);
    if (fileDel && method === 'DELETE') return handleAdminFilesDelete(request, env, fileDel[1], helpers);

    // Sessions + messages
    if (path === '/api/sessions' || path.startsWith('/api/sessions/')) return handleSessions(request, env);

    if (url.pathname.startsWith('/api/')) {
      return jsonErr(`Unknown route ${request.method} ${url.pathname}`, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
