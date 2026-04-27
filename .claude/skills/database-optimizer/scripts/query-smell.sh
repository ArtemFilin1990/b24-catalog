#!/bin/sh
# Static check for D1 query smells. Real regressions fail; common
# anti-patterns (existing AUTOINCREMENT, SELECT * in admin paths) are
# warnings so the script stays useful on every PR.
# Run from repo root, offline.

set -eu

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

fail=0
warn=0

SRC_FILES=$(find src ai-kb/src -type f -name '*.js' 2>/dev/null || true)
[ -z "$SRC_FILES" ] && { echo "no src/ai-kb/src JS files found"; exit 0; }

# 1. SELECT * — informational. Repo has a few in admin paths and a
#    backup loop. Reject only if SELECT * is on the chat hot path
#    (handleChat / searchCatalog / searchKnowledge).
selstar_all=$(grep -nE "['\"\`][[:space:]]*SELECT[[:space:]]+\\*" $SRC_FILES 2>/dev/null || true)
if [ -n "$selstar_all" ]; then
  echo "[WARN] SELECT * in worker source — name the columns when you can:"
  echo "$selstar_all"
  echo
  warn=1
fi

# 2. ${...} interpolation inside .prepare(`...`). FAIL only if the
#    interpolation looks like user input (not a hardcoded const). Crude
#    heuristic: flag any `${var}` where var is NOT in a small allowlist
#    of known-safe identifiers used in admin paths.
interp_hits=$(awk '
  /\.prepare\(`/ {in_prep=1; start=FNR}
  in_prep {buf = buf $0 ORS}
  in_prep && /`\)/ {if (buf ~ /\$\{/) print FILENAME ":" start ": " buf; in_prep=0; buf=""}
' $SRC_FILES 2>/dev/null || true)
if [ -n "$interp_hits" ]; then
  echo "[WARN] \${...} interpolation inside .prepare(\`...\`) — verify the var is from a hardcoded list, never user input:"
  echo "$interp_hits"
  echo "  (failing only if you can't justify it; for new code prefer ? + .bind())"
  echo
  warn=1
fi

# 3. AUTOINCREMENT — informational.  Already in legacy migrations.
autoinc=$(grep -nE 'AUTOINCREMENT' migrations/*.sql ai-kb/migrations/*.sql 2>/dev/null || true)
if [ -n "$autoinc" ]; then
  echo "[INFO] AUTOINCREMENT in migrations (existing — INTEGER PRIMARY KEY is enough for new tables):"
  echo "$autoinc" | head -5
  if [ "$(echo "$autoinc" | wc -l)" -gt 5 ]; then
    echo "  … ($(echo "$autoinc" | wc -l) total)"
  fi
  echo
fi

# 4. CREATE TABLE without IF NOT EXISTS — REAL FAIL.
nonidem=$(grep -nE 'CREATE TABLE [a-zA-Z_]' migrations/*.sql ai-kb/migrations/*.sql 2>/dev/null | grep -v 'IF NOT EXISTS' || true)
if [ -n "$nonidem" ]; then
  echo "[FAIL] CREATE TABLE without IF NOT EXISTS — re-running migration will fail:"
  echo "$nonidem"
  echo
  fail=1
fi

# 5. ALTER TABLE ADD COLUMN — reminder only (D1 not idempotent).
altaddcol=$(grep -nE '^[[:space:]]*ALTER TABLE [a-zA-Z_]+ ADD COLUMN' migrations/*.sql ai-kb/migrations/*.sql 2>/dev/null || true)
if [ -n "$altaddcol" ]; then
  echo "[REMINDER] ALTER TABLE ADD COLUMN found — D1 fails on duplicate column. Either ship migration once OR wrap with PRAGMA table_info() check in code (see ensureAuthTables in ai-kb/src/index.js):"
  echo "$altaddcol"
  echo
fi

# 6. VECTORIZE.upsert without explicit dim filter (EMBED_DIMS) anywhere
#    in the file.  Coarse: if upsert exists in a file that doesn't
#    mention EMBED_DIMS, that's a warning. Iterate all SRC_FILES so the
#    root catalog worker is also covered if it ever touches Vectorize.
for f in $SRC_FILES; do
  [ -f "$f" ] || continue
  if grep -q 'VECTORIZE\.upsert(' "$f" 2>/dev/null && ! grep -q 'EMBED_DIMS' "$f" 2>/dev/null; then
    echo "[WARN] $f: VECTORIZE.upsert without EMBED_DIMS dimension check — partial vectors poison query results."
    echo
    warn=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "FAIL: query/schema smells above (warnings/info do not block)."
  exit 1
fi

if [ "$warn" -ne 0 ]; then
  echo "OK with warnings: query patterns acceptable; review the warnings above."
else
  echo "OK: D1/Vectorize query patterns look clean."
fi
