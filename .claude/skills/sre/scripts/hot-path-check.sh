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

# 1. fetch() without AbortSignal.timeout in the same call expression.
#    Detection: load the whole file into an array, then for EACH `await
#    fetch(` line scan a 30-line forward window for AbortSignal.timeout
#    or for the end-of-call (`});` / `);` at column zero). Using getline
#    here would advance the global record cursor and skip nearby
#    fetch() calls entirely — see the array-based scan below.
#    Iterates every JS in src/ and ai-kb/src/ so new worker source
#    auto-enrolls.
WORKER_JS=$(find src ai-kb/src -type f -name '*.js' 2>/dev/null || true)
for f in $WORKER_JS; do
  [ -f "$f" ] || continue
  awk '
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (lines[i] !~ /await fetch\(/) continue
        # Track paren depth from the position of "await fetch(" so we
        # know when the call expression closes — bullet-proof against
        # both single-line `await fetch(url);` (closes on same line)
        # and multi-line `await fetch(url, {...});`.
        tail = lines[i]
        sub(/.*await fetch\(/, "", tail)
        depth = 1
        for (k = 1; k <= length(tail) && depth > 0; k++) {
          c = substr(tail, k, 1)
          if (c == "(") depth++
          else if (c == ")") depth--
        }
        window = lines[i]
        if (depth > 0) {
          end = (i + 30 < NR) ? i + 30 : NR
          for (j = i + 1; j <= end && depth > 0; j++) {
            window = window ORS lines[j]
            line_str = lines[j]
            for (k = 1; k <= length(line_str) && depth > 0; k++) {
              c = substr(line_str, k, 1)
              if (c == "(") depth++
              else if (c == ")") depth--
            }
          }
        }
        if (window !~ /AbortSignal\.timeout/) print FILENAME ":" i ": fetch without AbortSignal.timeout"
      }
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
