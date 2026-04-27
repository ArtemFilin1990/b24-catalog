#!/bin/sh
# Static check for SRE invariants on the chat hot path. Exits non-zero on
# real regressions only; surfaces existing findings as warnings so the
# script stays useful on every PR. Run from repo root, offline.

set -eu

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

INDEX="ai-kb/src/index.js"
fail=0
warn=0

if [ ! -f "$INDEX" ]; then
  echo "SKIP: $INDEX not present (not the ai-kb worker)"
  exit 0
fi

# 1. fetch() without AbortSignal.timeout in the same call.
#    Detection: for each `await fetch(` line, scan a 30-line window for
#    AbortSignal.timeout. If absent → real regression, fail.
for f in ai-kb/src/web_search.js ai-kb/src/index.js src/index.js; do
  [ -f "$f" ] || continue
  awk '
    /await fetch\(/ {
      start = NR
      buf = $0
      # Read up to 30 more lines or until we close the fetch call.
      for (i = 0; i < 30; i++) {
        if ((getline next_line) <= 0) break
        buf = buf ORS next_line
        # crude close: a line that ends a top-level call expression
        if (next_line ~ /^[[:space:]]*\}\);/ || next_line ~ /^[[:space:]]*\);$/) break
      }
      if (buf !~ /AbortSignal\.timeout/) print FILENAME ":" start ": fetch without AbortSignal.timeout"
    }
  ' "$f" > /tmp/fetch-$$.out 2>/dev/null || true
  if [ -s /tmp/fetch-$$.out ]; then
    echo "[FAIL] fetch without AbortSignal.timeout"
    cat /tmp/fetch-$$.out
    echo "  → wrap with AbortSignal.timeout(N) per references/golden-signals.md latency budget."
    echo
    fail=1
  fi
  rm -f /tmp/fetch-$$.out
done

# 2. console.* in worker source. Warning: useful as reminder but not a
#    blocker — backup cron has one legitimate console.log today.
console_hits=$(grep -nE 'console\.(log|info|debug)' ai-kb/src/*.js src/*.js 2>/dev/null || true)
if [ -n "$console_hits" ]; then
  echo "[WARN] console.* in worker source (use [observability] in wrangler.toml; CF captures status/route/latency for free):"
  echo "$console_hits"
  echo
  warn=1
fi

# 3. env.AI.run inside handleChat — informational, not a fail.
ai_calls=$(awk '
  /^async function handleChat/, /^}/ {
    if (/await env\.(AI\.run|VECTORIZE|DB\.batch)/) print FILENAME ":" NR ": " $0
  }' ai-kb/src/index.js 2>/dev/null || true)
if [ -n "$ai_calls" ]; then
  echo "[INFO] env.* call sites in handleChat — verify each is in a try/catch with fail-open semantics:"
  echo "$ai_calls"
  echo
fi

# 4. Reminder about ctx.waitUntil — pure prose.
echo "[REMINDER] verify saveMessages/logQuery/autoIngestWebHits stay inside ctx.waitUntil(persist) — never block the stream."
echo

if [ "$fail" -ne 0 ]; then
  echo "FAIL: SRE hot-path violations above (warnings/info do not block)."
  exit 1
fi

if [ "$warn" -ne 0 ]; then
  echo "OK with warnings: hot-path checks pass; review the warnings above."
else
  echo "OK: hot-path checks pass."
fi
