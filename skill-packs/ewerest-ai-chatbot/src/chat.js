// src/chat.js — основной /chat endpoint с памятью, RAG и логикой подшипников

import { loadHistory, saveTurn } from "./memory.js";
import { retrieveContext } from "./rag.js";
import { detectBearing, enrichBearingContext } from "./bearings.js";
import { buildSystemPrompt, buildMessages } from "./prompt.js";
import { getConfig } from "./config.js";

export async function handleChat(request, env) {
  const body = await request.json();
  const sessionId = body.session_id || request.headers.get("X-Session-Id") || crypto.randomUUID();
  const message = (body.message || "").trim();

  if (!message) throw httpError("empty_message", 400);
  if (message.length > 4000) throw httpError("message_too_long", 400);

  const cfg = await getConfig(env);
  const history = await loadHistory(env, sessionId, cfg.history_turns);
  const bearingHint = detectBearing(message);
  const ragContext = await retrieveContext(env, {
    query: message,
    kbTopK: cfg.kb_top_k,
    catalogTopK: cfg.catalog_top_k,
    bearingHint,
  });
  const bearingContext = bearingHint ? await enrichBearingContext(env, bearingHint) : null;
  const systemPrompt = await buildSystemPrompt(env, cfg, { ragContext, bearingContext });
  const messages = buildMessages(systemPrompt, history, message);

  const aiResponse = await env.AI.run(cfg.chat_model, {
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
  });

  const answer = typeof aiResponse === "string" ? aiResponse : aiResponse.response || aiResponse.output_text || "";
  if (!answer) throw httpError("empty_ai_response", 502);

  await saveTurn(env, sessionId, "user", message);
  await saveTurn(env, sessionId, "assistant", answer);

  return {
    session_id: sessionId,
    answer,
    sources: ragContext.sources,
    bearing: bearingContext ? bearingContext.summary : null,
  };
}

function httpError(msg, status) {
  const e = new Error(msg);
  e.status = status;
  e.code = msg;
  return e;
}
