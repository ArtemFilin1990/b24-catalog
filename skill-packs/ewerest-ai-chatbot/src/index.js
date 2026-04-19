// src/index.js — Эверест AI Chatbot (Cloudflare Workers)
// Роутер: /chat, /admin/*, /upload, /ingest, статика через ASSETS

import { handleChat } from "./chat.js";
import { handleAdmin } from "./admin.js";
import { handleUpload, handleIngest } from "./rag.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-Id",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      // API routes
      if (pathname === "/chat" && request.method === "POST") {
        return json(await handleChat(request, env), 200);
      }

      if (pathname === "/upload" && request.method === "POST") {
        requireAdmin(request, env);
        return json(await handleUpload(request, env), 200);
      }

      if (pathname === "/ingest" && request.method === "POST") {
        requireAdmin(request, env);
        return json(await handleIngest(request, env), 200);
      }

      if (pathname.startsWith("/admin/")) {
        requireAdmin(request, env);
        return json(await handleAdmin(request, env), 200);
      }

      if (pathname === "/health") {
        return json({ ok: true, ts: Date.now() }, 200);
      }

      // Статика (админка UI) через ASSETS binding
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return json({ error: "not_found", path: pathname }, 404);
    } catch (err) {
      const code = err.status || 500;
      console.error("Worker error:", err);
      return json({ error: err.message, code: err.code || "internal" }, code);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    const e = new Error("unauthorized");
    e.status = 401;
    e.code = "auth";
    throw e;
  }
}
