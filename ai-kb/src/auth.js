// ai-kb/src/auth.js
// Простая авторизация по имени + паролю.
//
// Хранение пароля: PBKDF2-SHA256, 100_000 итераций, 16-байтовая соль.
// Всё через Web Crypto (crypto.subtle) — никаких внешних зависимостей.
// На Cloudflare Workers это нативно и стоит копейки: PBKDF2 100k на 8-символьном
// пароле занимает ~15-20ms CPU, что далеко от лимита 50ms на CPU для free-tier.
//
// Сессия: 32 случайных байта hex в user_sessions.token; клиент кладёт в
// localStorage и шлёт `Authorization: Bearer <token>`. Живёт 30 дней.

const PBKDF2_ITERS = 100_000;
const SESSION_DAYS = 30;

// Name: 3–32 символа; разрешены ASCII (букв/цифр/-_. пробел) и кириллица.
// Сознательно без email — пользователь попросил «просто имя».
const USERNAME_RE = /^[A-Za-z0-9_.\- \u0400-\u04FF]{3,32}$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;

// ---------- Hex helpers ----------
function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function randomHex(nBytes) {
  const buf = new Uint8Array(nBytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export function genSalt()  { return randomHex(16); }
export function genToken() { return randomHex(32); }

export function newUserId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return randomHex(16);
}

// ---------- Hashing ----------
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(saltHex), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    keyMat,
    256,
  );
  return toHex(bits);
}

// Constant-time hex compare. Guards password verification against timing
// side-channels that would otherwise leak "hash prefix matches up to byte N".
export function safeEqHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Request validation ----------
export function validateCredentials(body) {
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  if (!USERNAME_RE.test(username)) {
    return { error: 'Имя: 3–32 символа (буквы, цифры, "-", "_", ".", пробел)' };
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `Пароль: минимум ${MIN_PASSWORD} символов` };
  }
  if (password.length > MAX_PASSWORD) {
    return { error: `Пароль слишком длинный (максимум ${MAX_PASSWORD})` };
  }
  return { username, password };
}

// ---------- Bearer extraction ----------
export function extractBearer(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+([A-Fa-f0-9]{32,128})$/);
  return m ? m[1] : null;
}

// ---------- Session lifecycle ----------
export async function createSessionToken(env, userId) {
  const token = genToken();
  // ISO string trimmed to D1 DATETIME format: "YYYY-MM-DD HH:MM:SS".
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000)
    .toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare(
    'INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, userId, expires).run();
  return { token, expires_at: expires };
}

export async function revokeToken(env, token) {
  if (!token) return;
  try {
    await env.DB.prepare('DELETE FROM user_sessions WHERE token = ?').bind(token).run();
  } catch { /* best-effort */ }
}

// Resolves the caller to { id, username } or null.
// Also rejects expired tokens. Never throws — callers just null-check.
export async function resolveUser(request, env) {
  const token = extractBearer(request);
  if (!token) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT u.id, u.username, s.expires_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    ).bind(token).first();
    if (!row) return null;
    // D1 stores "YYYY-MM-DD HH:MM:SS" in UTC; append Z so Date parses as UTC.
    const exp = new Date(String(row.expires_at).replace(' ', 'T') + 'Z');
    if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) return null;
    return { id: row.id, username: row.username };
  } catch { return null; }
}
