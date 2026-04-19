// src/memory.js — история диалога в D1

export async function loadHistory(env, sessionId, limit = 10) {
  const stmt = env.DB.prepare(
    `SELECT role, content FROM chat_history
     WHERE session_id = ?1
     ORDER BY ts DESC
     LIMIT ?2`
  ).bind(sessionId, limit);

  const { results } = await stmt.all();
  return (results || []).reverse().map((r) => ({ role: r.role, content: r.content }));
}

export async function saveTurn(env, sessionId, role, content) {
  if (!["user", "assistant", "system"].includes(role)) {
    throw new Error(`invalid role: ${role}`);
  }
  await env.DB.prepare(
    `INSERT INTO chat_history (session_id, role, content, ts)
     VALUES (?1, ?2, ?3, ?4)`
  )
    .bind(sessionId, role, content, Date.now())
    .run();
}

export async function clearSession(env, sessionId) {
  const r = await env.DB.prepare(`DELETE FROM chat_history WHERE session_id = ?1`)
    .bind(sessionId)
    .run();
  return { deleted: r.meta?.changes ?? 0 };
}

export async function cleanupOld(env, ttlDays = 30) {
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
  const r = await env.DB.prepare(`DELETE FROM chat_history WHERE ts < ?1`)
    .bind(cutoff)
    .run();
  return { deleted: r.meta?.changes ?? 0 };
}
