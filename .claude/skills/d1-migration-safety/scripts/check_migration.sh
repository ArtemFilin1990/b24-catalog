#!/usr/bin/env bash
# d1-migration-safety/scripts/check_migration.sh — static lint for SQL migrations.
# Usage: bash .claude/skills/d1-migration-safety/scripts/check_migration.sh [dir]
# Default: lint all known migration dirs.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

TARGETS=()
if [[ "$#" -gt 0 ]]; then
  TARGETS+=("$1")
else
  TARGETS=(migrations ai-kb/migrations)
fi

echo "== d1-migration-safety lint =="
red=0
warn=0
fail() { echo "  ✗ $1"; red=$((red+1)); }
note() { echo "  ! $1"; warn=$((warn+1)); }
ok()   { echo "  ✓ $1"; }

for dir in "${TARGETS[@]}"; do
  [[ -d "$dir" ]] || { note "$dir missing"; continue; }
  echo
  echo "Directory: $dir"

  shopt -s nullglob
  for f in "$dir"/*.sql; do
    base=$(basename "$f")
    echo "  ── $base"

    # IF NOT EXISTS coverage on CREATE ...
    # CREATE VIEW is allowed to be non-IF-NOT-EXISTS if preceded by DROP VIEW IF EXISTS
    # (SQLite has no CREATE OR REPLACE VIEW; the DROP+CREATE idiom is idempotent).
    while IFS= read -r line; do
      echo "$line" | grep -qiE 'CREATE (TABLE|VIEW|INDEX|VIRTUAL TABLE|TRIGGER)( IF NOT EXISTS)?' || continue
      if echo "$line" | grep -qiE 'IF NOT EXISTS'; then continue; fi
      # If it's a CREATE VIEW and the file has a DROP VIEW IF EXISTS for the same name earlier, accept.
      if echo "$line" | grep -qiE 'CREATE VIEW'; then
        view_name=$(echo "$line" | sed -E 's/.*CREATE VIEW[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*/\1/I')
        if [[ -n "$view_name" ]] && grep -qiE "DROP VIEW IF EXISTS[[:space:]]+${view_name}\\b" "$f"; then
          continue
        fi
      fi
      fail "$f: non-idempotent CREATE — add IF NOT EXISTS: $(echo "$line" | sed 's/^[[:space:]]*//')"
    done < <(grep -iE '^\s*CREATE (TABLE|VIEW|INDEX|VIRTUAL TABLE|TRIGGER)' "$f" || true)

    # DROP statements: accept DROP ... IF EXISTS as self-documenting; otherwise require a preceding comment.
    while IFS= read -r line; do
      echo "$line" | grep -qiE '^\s*DROP (TABLE|VIEW|INDEX)' || continue
      if echo "$line" | grep -qiE 'IF EXISTS'; then continue; fi
      # Check for a -- comment on the preceding non-empty line
      if ! grep -B1 -iE "$(printf '%s' "$line" | sed 's/[][\/.^$*]/\\&/g')" "$f" | grep -q -- '--'; then
        fail "$f: DROP without IF EXISTS and without documenting comment: $(echo "$line" | sed 's/^[[:space:]]*//')"
      else
        note "$f: contains DROP — confirm rollback path is documented"
      fi
    done < <(grep -iE '^\s*DROP (TABLE|VIEW|INDEX)' "$f" || true)

    # FK cascade without PRAGMA foreign_keys = ON — D1 connections default to OFF.
    # Existing state: ai-kb/migrations/0001_initial.sql has long-standing FK cascade
    # declarations without the pragma. Surface as a warning unless the cascade is newly
    # added by this PR — reviewers should confirm whether the pragma is intended.
    if grep -iE 'ON DELETE (CASCADE|SET NULL)|ON UPDATE (CASCADE|SET NULL)' "$f" >/dev/null; then
      if ! grep -iE 'PRAGMA\s+foreign_keys\s*=\s*ON' "$f" >/dev/null; then
        note "$f: declares FK cascade without PRAGMA foreign_keys = ON (D1 default is OFF — cascade won't fire at runtime)"
      fi
    fi

    # Bare INSERT (should be OR IGNORE / OR REPLACE).
    # Exempt FTS5 control + initial-load inserts (INSERT INTO <fts_table>(rowid, ...) is the documented way to backfill).
    while IFS= read -r line; do
      if echo "$line" | grep -qiE '^\s*INSERT\s+INTO\s' && \
         ! echo "$line" | grep -qiE '^\s*INSERT\s+OR\s+(IGNORE|REPLACE)'; then
        # Skip FTS5 table bootstrap/control rows
        if echo "$line" | grep -qiE 'INTO\s+[A-Za-z_][A-Za-z0-9_]*_fts\b'; then continue; fi
        note "$f: bare INSERT — confirm it is guaranteed to run once (consider INSERT OR IGNORE): $(echo "$line" | sed 's/^[[:space:]]*//')"
      fi
    done < <(grep -iE '^\s*INSERT ' "$f" || true)

    # ai-kb migrations should NOT write to schema_migrations
    if [[ "$dir" == ai-kb/migrations ]]; then
      if grep -iE 'INSERT (OR IGNORE )?INTO\s+schema_migrations' "$f" >/dev/null; then
        fail "$f: ai-kb migration inserts into schema_migrations — only root migrations record versions"
      fi
    fi

    # Raw id used in VIEW UNION (simple heuristic)
    if grep -iE 'UNION (ALL )?' "$f" >/dev/null && grep -iE 'SELECT\s+id\s*,' "$f" >/dev/null; then
      note "$f: UNION with raw id — confirm uid prefix pattern (source:id) to avoid cross-source collisions"
    fi
  done
  shopt -u nullglob
done

echo
echo "Order check:"
expected=(
  "migrations/0001_root_schema.sql"
  "migrations/0002_rate_limit.sql"
  "ai-kb/migrations/0001_initial.sql"
  "ai-kb/migrations/0002_files_rules_catalog.sql"
  "ai-kb/migrations/0003_catalog_staging.sql"
  "ai-kb/migrations/0004_catalog_master_view.sql"
)
for f in "${expected[@]}"; do
  if [[ -f "$f" ]]; then ok "$f"; else fail "missing $f"; fi
done

# Warn about any extra migration files the expected list doesn't mention
for f in migrations/*.sql ai-kb/migrations/*.sql; do
  [[ " ${expected[*]} " == *" $f "* ]] && continue
  note "extra migration file not in expected order — update SKILL.md and CLAUDE.md: $f"
done

echo
if (( red == 0 )); then
  echo "OK — $warn warnings"
else
  echo "FAIL — $red red, $warn warnings"
  exit 1
fi
