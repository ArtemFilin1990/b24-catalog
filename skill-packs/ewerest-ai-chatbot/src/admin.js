// src/admin.js — админ-эндпоинты для правки промпта, параметров, управления сессиями

import { getConfig, setConfigKey } from "./config.js";
import { clearSession, cleanupOld } from "./memory.js";

/**
 * Роутинг по /admin/*.
 */
export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin\//, "");
  const method = request.method;

  // GET /admin/config
  if (path === "config" && method === "GET") {
    return await getConfig(env);
  }

  // PUT /admin/config/:key  body: { value: any }
  const keyMatch = path.match(/^config\/(.+)$/);
  if (keyMatch && method === "PUT") {
    const key = keyMatch[1];
    const body = await request.json();
    await setConfigKey(env, key, body.value);
    return { ok: true, key, value: body.value };
  }

  // GET /admin/documents
  if (path === "documents" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT doc_id, title, category, filename, size, uploaded_at, indexed, chunks
       FROM documents
       ORDER BY uploaded_at DESC
       LIMIT 100`
    ).all();
    return { documents: results || [] };
  }

  // DELETE /admin/documents/:id
  const docMatch = path.match(/^documents\/(.+)$/);
  if (docMatch && method === "DELETE") {
    const docId = docMatch[1];
    const doc = await env.DB.prepare(
      `SELECT r2_key FROM documents WHERE doc_id = ?1`
    )
      .bind(docId)
      .first();

    if (doc?.r2_key) {
      await env.R2.delete(doc.r2_key);
      await env.R2.delete(`docs/${docId}.txt`);
    }

    if (env.KB_INDEX?.deleteByIds) {
      const ids = Array.from({ length: 1000 }, (_, i) => `${docId}-${i}`);
      await env.KB_INDEX.deleteByIds(ids).catch(() => {});
    }

    await env.DB.prepare(`DELETE FROM documents WHERE doc_id = ?1`)
      .bind(docId)
      .run();

    return { ok: true, deleted: docId };
  }

  // DELETE /admin/session/:id
  const sessMatch = path.match(/^session\/(.+)$/);
  if (sessMatch && method === "DELETE") {
    return await clearSession(env, sessMatch[1]);
  }

  // POST /admin/cleanup — чистка старых сессий
  if (path === "cleanup" && method === "POST") {
    return await cleanupOld(env, 30);
  }

  // GET /admin/stats
  if (path === "stats" && method === "GET") {
    const msgs = await env.DB.prepare(`SELECT COUNT(*) AS n FROM chat_history`).first();
    const sessions = await env.DB.prepare(`SELECT COUNT(DISTINCT session_id) AS n FROM chat_history`).first();
    const docs = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(indexed) AS indexed FROM documents`).first();
    const catalog = await env.DB.prepare(`SELECT COUNT(*) AS n FROM catalog`).first();
    return {
      messages: msgs?.n ?? 0,
      sessions: sessions?.n ?? 0,
      documents: docs?.n ?? 0,
      indexed_documents: docs?.indexed ?? 0,
      catalog_items: catalog?.n ?? 0,
    };
  }

  const e = new Error(`unknown_admin_route: ${method} ${path}`);
  e.status = 404;
  throw e;
}
