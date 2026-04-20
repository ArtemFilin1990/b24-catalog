#!/usr/bin/env bash
# catalog-import-review/scripts/review_catalog_sql.sh — static scan for known anti-patterns
# in the catalog import pipeline SQL (staging → catalog_rows → catalog_master_view).
# Usage: bash .claude/skills/catalog-import-review/scripts/review_catalog_sql.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "== catalog-import-review static scan =="
red=0
warn=0
fail() { echo "  ✗ $1"; red=$((red+1)); }
note() { echo "  ! $1"; warn=$((warn+1)); }
ok()   { echo "  ✓ $1"; }

files=()
for f in migrations/*.sql ai-kb/migrations/*.sql; do
  [[ -f "$f" ]] && files+=("$f")
done
[[ "${#files[@]}" -gt 0 ]] || { echo "no migration files found"; exit 0; }

for f in "${files[@]}"; do
  base=$(basename "$f")

  # A) staging promotion keyed only on id
  if grep -iE 'INSERT\s+INTO\s+catalog_rows' "$f" | grep -q -i 'staging_catalog_import'; then
    if ! grep -iE 'NOT EXISTS' "$f" >/dev/null; then
      fail "$f: staging → catalog_rows promotion without NOT EXISTS on business key"
    fi
    if ! grep -iE "status\s*=\s*'approved'" "$f" >/dev/null; then
      fail "$f: promotion does not gate on status='approved'"
    fi
    if ! grep -iE 'reviewed_at' "$f" >/dev/null; then
      note "$f: promotion should also check reviewed_at IS NOT NULL"
    fi
  fi

  # B) catalog_master_view without validation filter
  if grep -iE 'CREATE\s+VIEW.*catalog_master_view' "$f" >/dev/null; then
    # Accept either `validation_status = 'valid'` or `validation_status IN (...)` with 'valid'.
    if ! grep -iE "validation_status\\s*(=\\s*'valid'|IN\\s*\\([^)]*'valid')" "$f" >/dev/null; then
      fail "$f: catalog_master_view missing validation_status filter (='valid' or IN('valid',...))"
    fi
    if grep -iE 'UNION' "$f" >/dev/null && ! grep -iE "'catalog(_rows)?:'\\s*\\|\\|" "$f" >/dev/null; then
      fail "$f: catalog_master_view UNIONs without source-prefixed uid"
    fi
  fi

  # C) FK cascade without PRAGMA — warn only (long-standing state in 0001_initial.sql).
  if grep -iE 'ON DELETE (CASCADE|SET NULL)' "$f" >/dev/null && \
     ! grep -iE 'PRAGMA\s+foreign_keys\s*=\s*ON' "$f" >/dev/null; then
    note "$f: FK cascade declared without PRAGMA foreign_keys = ON (D1 default is OFF)"
  fi
done

# D) Worker code must not SELECT directly from staging_catalog_import
if grep -nE "FROM\s+staging_catalog_import" ai-kb/src/*.js src/*.js 2>/dev/null \
     | grep -v 'admin\|/api/admin'; then
  fail "worker code reads from staging_catalog_import outside admin routes"
else
  ok "no non-admin reads from staging_catalog_import"
fi

# E) Worker code should prefer catalog_master_view for bot reads
if grep -n 'catalog_master_view' ai-kb/src/index.js >/dev/null 2>&1; then
  ok "ai-kb/src/index.js references catalog_master_view"
else
  note "ai-kb/src/index.js does not reference catalog_master_view — bot may be reading legacy catalog only. Confirm fallback is intentional."
fi

# F) Upload dedupe — files table should be keyed on sha256
if grep -iE 'CREATE TABLE (IF NOT EXISTS )?files' ai-kb/migrations/*.sql >/dev/null; then
  if ! grep -iE 'sha256' ai-kb/migrations/*.sql >/dev/null; then
    fail "files table has no sha256 — duplicate uploads will multiply rows"
  fi
fi

echo
if (( red == 0 )); then
  echo "OK — $warn warnings"
else
  echo "FAIL — $red red, $warn warnings"
  exit 1
fi
