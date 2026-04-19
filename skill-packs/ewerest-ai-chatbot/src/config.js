// src/config.js — работа с конфигом бота (D1 таблица config)

const DEFAULTS = {
  chat_model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  embedding_model: "@cf/baai/bge-m3",
  temperature: 0.3,
  max_tokens: 1024,
  catalog_top_k: 5,
  kb_top_k: 5,
  history_turns: 10,
  system_prompt: null,
};

export async function getConfig(env) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM config`).all();
  const fromDb = {};
  for (const row of results || []) {
    fromDb[row.key] = tryParse(row.value);
  }
  return { ...DEFAULTS, ...fromDb };
}

export async function setConfigKey(env, key, value) {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  await env.DB.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, str, Date.now())
    .run();
}

function tryParse(s) {
  if (s === null || s === undefined) return null;
  const n = Number(s);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(s)) return n;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
