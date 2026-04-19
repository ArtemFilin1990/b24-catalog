// ai-kb/src/ratelimit.js
// Shared with ../../src/ratelimit.js — keep identical so limits behave the
// same no matter which worker serves the endpoint. D1 table rate_limit is
// defined in migrations/0002_rate_limit.sql.
//
// Fixed-window counter: one row per (bucket, window_start) with atomic
// UPSERT increment. Tradeoff vs sliding-window: can allow up to 2×limit
// at window boundaries. Acceptable for cost-protection use-cases; switch
// to a token-bucket if you need strict enforcement.

/**
 * Check and record a request against a rate limit bucket.
 *
 * @param {D1Database} db       - env.DB
 * @param {string}     bucket   - "<endpoint>:<ip>" or similar discriminator
 * @param {number}     limit    - max requests per window
 * @param {number}     windowSec - window size in seconds
 * @returns {Promise<{allowed:boolean, count:number, remaining:number, resetAt:number}>}
 */
export async function checkRate(db, bucket, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSec) * windowSec;
  const resetAt = windowStart + windowSec;

  try {
    const row = await db
      .prepare(
        'INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, 1) ' +
        'ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1 ' +
        'RETURNING count'
      )
      .bind(bucket, windowStart)
      .first();
    const count = row?.count ?? 1;
    return {
      allowed: count <= limit,
      count,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch (e) {
    // Fail-open on DB error: availability > strict enforcement.
    // A broken rate-limit table must not take down chat/orders.
    return { allowed: true, count: 0, remaining: limit, resetAt, error: e?.message };
  }
}

/**
 * Build a bucket key: `<endpoint>:<client-ip>`.
 * Falls back to a shared bucket if no IP header is present (unlikely on CF).
 */
export function bucketForRequest(request, endpoint) {
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')?.[0]?.trim()
    || 'unknown';
  return `${endpoint}:${ip}`;
}

/**
 * Standard 429 response with Retry-After + RateLimit headers per draft RFC.
 * Ships default CORS headers so a browser client can actually read the body
 * on cross-origin usage. Callers can pass their worker-local FRAME_HEADERS
 * to override (e.g. when a tighter allow-origin whitelist is wanted).
 */
const DEFAULT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Upload-Token',
  'Access-Control-Expose-Headers': 'Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset',
};

export function rateLimitedResponse(result, headers = {}) {
  const retryAfter = Math.max(1, result.resetAt - Math.floor(Date.now() / 1000));
  return new Response(
    JSON.stringify({ ok: false, error: 'Rate limit exceeded. Slow down.', retry_after_sec: retryAfter }),
    {
      status: 429,
      headers: {
        ...DEFAULT_CORS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfter),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(result.resetAt),
        ...headers,
      },
    }
  );
}
