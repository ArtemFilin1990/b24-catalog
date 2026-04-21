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
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': key,
      },
      // 5s cap — if Brave is slow we'd rather return no web results than
      // block the user's chat stream.
      signal: AbortSignal.timeout(5000),
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
 * Render search hits into a compact context block the LLM can consume.
 * Empty array → empty string so callers don't have to null-check.
 */
export function formatWebContext(hits) {
  if (!hits?.length) return '';
  const lines = hits.map((h, i) => {
    const n = i + 1;
    return `[${n}] ${h.title}\n    ${h.url}\n    ${h.snippet}`;
  });
  return lines.join('\n');
}
