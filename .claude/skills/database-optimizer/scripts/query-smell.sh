#!/bin/sh
# Static check for D1 query smells. Real regressions fail; common
# anti-patterns (existing AUTOINCREMENT, SELECT * in admin paths) are
# warnings so the script stays useful on every PR.
# Run from repo root, offline.
#
# KNOWN LIMITATIONS (intentional — bash-grep is line-oriented):
#   - The CREATE TABLE idempotency check requires the table identifier
#     on the same line as `CREATE TABLE`. SQL split across lines like
#     `CREATE TABLE\n  foo (...)` slips past. The repo convention puts
#     the identifier on the same line; rely on the d1-migration-safety
#     skill checklist (and PR review) for split-DDL coverage.
#   - The interpolation check is purely syntactic. It cannot tell a
#     hardcoded const from user input; reviewer must verify each hit.

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

# 2. ${...} interpolation inside .prepare(`...`) — warning only.
#    Coarse: flags ANY template interpolation inside prepared SQL.
#    Reviewer must confirm the var is not user-controlled. The script
#    does NOT apply an allowlist heuristic and does not fail — that
#    static distinction is unreliable, so treat every hit as worth eyes.
interp_hits=$(awk '
  /\.prepare\(`/ {in_prep=1; start=FNR}
  in_prep {buf = buf $0 ORS}
  in_prep && /`\)/ {if (buf ~ /\$\{/) print FILENAME ":" start ": " buf; in_prep=0; buf=""}
' $SRC_FILES 2>/dev/null || true)
if [ -n "$interp_hits" ]; then
  echo "[WARN] \${...} interpolation inside .prepare(\`...\`) — review manually; prefer ? + .bind() for new code:"
  echo "$interp_hits"
  echo "  (this check warns on any interpolation; it does not fail or apply an allowlist)"
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
#    Case-insensitive: SQLite/D1 accept lowercase keywords too. Allow the
#    identifier after TABLE to start with a letter, underscore OR a
#    quoted-identifier opener (`"`, backtick, `[`) — `CREATE TABLE "foo"`
#    is valid SQLite and would otherwise bypass the check.
nonidem=$(grep -niE 'create[[:space:]]+table[[:space:]]+([a-z_]|"|`|\[)' migrations/*.sql ai-kb/migrations/*.sql 2>/dev/null | grep -ivE 'if[[:space:]]+not[[:space:]]+exists' || true)
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
