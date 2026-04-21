// ai-kb/src/web_search.js
// Brave Search integration — gives the bot a fourth retrieval leg for
// questions that the local catalog + knowledge base can't answer.
//
// Why Brave:
// - Free tier: 2000 queries/month, 1 QPS. Plenty for a private bot.
// - REST + JSON, no captcha / token-exchange dance.
// - Bot-friendly ToS (Brave explicitly allows automated use of its API).
//
// Secret (Worker env): BRAVE_API_KEY. If not set, webSearch is a no-op
// returning [] — existing RAG legs still work.
//
// Caller should always treat failures as empty — never let a flaky
// third-party search break /api/chat.

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

// Hard cap: don't let the LLM (or an admin setting) request more than
// ~10 results — Brave's response payload grows linearly and we trim the
// snippets anyway.
const MAX_TOPK = 10;

// Each snippet gets trimmed to this length before joining; longer strings
// just blow up the prompt with boilerplate without adding signal.
const MAX_SNIPPET_CHARS = 240;

/**
 * Run a web search.
 *
 * @param {object} env       Worker env (must expose BRAVE_API_KEY).
 * @param {string} query     Raw user question. No normalization needed —
 *                           Brave handles Cyrillic fine.
 * @param {number} topK      Target result count (clamped to [0, MAX_TOPK]).
 * @returns {Promise<Array<{title:string,url:string,snippet:string}>>}
 */
export async function webSearch(env, query, topK = 3) {
  const key = env?.BRAVE_API_KEY;
  if (!key) return [];
  const k = Math.max(0, Math.min(MAX_TOPK, Number(topK) || 0));
  if (k === 0) return [];
  const q = String(query || '').trim().slice(0, 400);
  if (!q) return [];

  try {
    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set('q', q);
    url.searchParams.set('count', String(k));
    // Russian-first results — bot audience is RU-speaking. Brave still
    // mixes in EN hits when they're more relevant, this just tilts the
    // default ranking.
    url.searchParams.set('country', 'RU');
    url.searchParams.set('search_lang', 'ru');
    url.searchParams.set('safesearch', 'moderate');
    // Short cache window on the Brave side reduces duplicate spend when
    // the same question is asked twice in a row.
    url.searchParams.set('freshness', 'py'); // past year

    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        // Do NOT set Accept-Encoding here — it's a forbidden header in the
        // Fetch/Workers runtime and setting it throws TypeError, which
        // would make this integration silently fail-open. The runtime
        // negotiates compression with Brave automatically.
        'X-Subscription-Token': key,
      },
      // Tight 2.5s budget. The web leg sits inside the same Promise.all
      // as catalog FTS, Vectorize, and geo lookup — if Brave stalls, all
      // three local legs wait with it and the user sees the first LLM
      // token that many seconds late. At 2.5s we still catch Brave's
      // normal p99 (~1.5s); on a slow day we skip web and let local
      // retrieval answer.
      signal: AbortSignal.timeout(2500),
    });
    if (!resp.ok) return [];
    const json = await resp.json();
    const results = json?.web?.results;
    if (!Array.isArray(results)) return [];
    return results.slice(0, k).map(r => ({
      title:   String(r.title || '').slice(0, 160),
      url:     String(r.url || ''),
      snippet: String(r.description || r.snippet || '')
        .replace(/<[^>]+>/g, '')
        .slice(0, MAX_SNIPPET_CHARS),
    })).filter(r => r.url);
  } catch {
    return [];
  }
}

/**
 * Neutralise anything inside a Brave hit that could prematurely close the
 * UNTRUSTED_WEB_BEGIN/END sandbox handleChat wraps around the web block.
 *
 * The defense is purely structural: if an attacker's snippet contains the
 * literal END marker, the LLM would treat everything after it as trusted
 * context — "closing the door" from inside the untrusted section. We break
 * any substring that matches the marker shape before it's ever emitted.
 *
 * Exported so autoIngestWebHits can apply the same sanitisation before
 * persisting web snippets into knowledge_base — otherwise the marker
 * could be smuggled at ingest time and surface at retrieval.
 */
export function sanitizeForUntrustedBlock(s) {
  return String(s ?? '')
    // Break the exact markers.
    .replace(/UNTRUSTED_WEB_(BEGIN|END)/gi, 'UNTRUSTED_WEB_$1_REDACTED')
    // Defence in depth: also break any `===` run of 3+ so an attacker
    // can't invent a new marker shape we might adopt later.
    .replace(/={3,}/g, '==[=]==');
}

/**
 * Render search hits into a compact context block the LLM can consume.
 * Empty array → empty string so callers don't have to null-check.
 */
export function formatWebContext(hits) {
  if (!hits?.length) return '';
  const lines = hits.map((h, i) => {
    const n = i + 1;
    const title   = sanitizeForUntrustedBlock(h.title);
    const url     = sanitizeForUntrustedBlock(h.url);
    const snippet = sanitizeForUntrustedBlock(h.snippet);
    return `[${n}] ${title}\n    ${url}\n    ${snippet}`;
  });
  return lines.join('\n');
}
