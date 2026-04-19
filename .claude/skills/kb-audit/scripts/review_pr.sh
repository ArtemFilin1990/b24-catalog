#!/usr/bin/env bash
# kb-audit/scripts/review_pr.sh — static triage of the current branch vs a base.
# Lists changed files, routes review load to specialist skills, highlights risky files.
# Usage: bash .claude/skills/kb-audit/scripts/review_pr.sh [base_ref]
# Default base: origin/main (falls back to main).
set -euo pipefail

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    BASE="origin/main"
  elif git rev-parse --verify --quiet main >/dev/null; then
    BASE="main"
  else
    echo "no base ref; pass one explicitly (e.g. origin/main)"; exit 2
  fi
fi

# In a shallow clone the base ref may exist but history may not overlap.
# Use merge-base when possible; otherwise fall back to direct diff.
if MB=$(git merge-base "$BASE" HEAD 2>/dev/null) && [[ -n "$MB" ]]; then
  DIFF_BASE="$MB"
else
  DIFF_BASE="$BASE"
fi

echo "== kb-audit triage: $(git rev-parse --abbrev-ref HEAD) vs $BASE =="

CHANGED=$(git diff --name-only "$DIFF_BASE"...HEAD || true)
if [[ -z "$CHANGED" ]]; then
  echo "no changes vs $BASE"; exit 0
fi

echo
echo "Changed files:"
echo "$CHANGED" | sed 's/^/  /'

load_skill() { echo "  → load .claude/skills/$1"; }

echo
echo "Suggested specialist skills:"
echo "$CHANGED" | grep -qE '^(migrations/|ai-kb/migrations/).*\.sql$'              && load_skill d1-migration-safety || true
echo "$CHANGED" | grep -qE '^(src/index\.js|ai-kb/src/.*\.js|wrangler\.toml|ai-kb/wrangler\.toml|\.github/workflows/deploy.*\.yml)$' \
                                                                                  && load_skill cloudflare-worker-review || true
echo "$CHANGED" | grep -qE '(staging_catalog_import|catalog_rows|catalog_master_view|/api/imports|imported_rows)' \
                                                                                  && load_skill catalog-import-review || true
# Bearing prompt / analog heuristic: changes to AI_SYSTEM constant, searchCatalog, catalog_* analog columns
if git diff "$DIFF_BASE"...HEAD -- ai-kb/src/index.js src/index.js 2>/dev/null | grep -qE 'AI_SYSTEM|searchCatalog|catalogRowToText|skf_analog|fag_analog|nsk_analog|ntn_analog|zwz_analog'; then
  load_skill bearing-analog-check
fi
echo "$CHANGED" | grep -q '^ai-kb/'                                                && load_skill ai-kb-chatbot-build || true

echo
echo "Red-flag scan:"

red=0
# 1. hardcoded admin/upload tokens being reintroduced
if git diff "$DIFF_BASE"...HEAD -- '*.js' 2>/dev/null | grep -nE '^\+.*(ADMIN_TOKEN|UPLOAD_TOKEN)\s*=\s*["'\'']' | grep -v 'env\.'; then
  echo "  ✗ possible hardcoded token reintroduced"; red=$((red+1))
fi
# 2. runtime CREATE TABLE in worker code (grandfathered: ensureSettingsTable)
if git diff "$DIFF_BASE"...HEAD -- '*.js' 2>/dev/null | grep -nE '^\+.*CREATE TABLE' | grep -vi 'ensureSettingsTable'; then
  echo "  ✗ runtime CREATE TABLE added outside migrations (grandfather: ensureSettingsTable only)"; red=$((red+1))
fi
# 3. admin route without audit
if git diff "$DIFF_BASE"...HEAD -- '*.js' 2>/dev/null | grep -q '^+.*requireAdmin(request, env)' && \
   ! git diff "$DIFF_BASE"...HEAD -- '*.js' 2>/dev/null | grep -q '^+.*ctx\.waitUntil(audit'; then
  echo "  ! new requireAdmin check but no new audit() call — confirm every new admin route logs"; red=$((red+1))
fi
# 4. deploy workflow: retry loop / wrangler pin
if echo "$CHANGED" | grep -q '^\.github/workflows/deploy-ai-kb\.yml$'; then
  if ! grep -q 'wrangler@4\.83\.0' .github/workflows/deploy-ai-kb.yml; then
    echo "  ✗ wrangler@4.83.0 pin missing from deploy-ai-kb.yml"; red=$((red+1))
  fi
  if ! grep -qE 'Бот Эверест|<title>' .github/workflows/deploy-ai-kb.yml; then
    echo "  ✗ title verification missing from deploy-ai-kb.yml"; red=$((red+1))
  fi
fi
# 5. schema_migrations insert added to an ai-kb migration
for f in $(echo "$CHANGED" | grep '^ai-kb/migrations/.*\.sql$' || true); do
  if grep -qiE 'INSERT (OR IGNORE )?INTO schema_migrations' "$f"; then
    echo "  ✗ $f inserts into schema_migrations — ai-kb migrations intentionally do not"; red=$((red+1))
  fi
done
# 6. Vectorize upsert without dim filter
if git diff "$DIFF_BASE"...HEAD -- '*.js' 2>/dev/null | grep -q '^+.*VECTORIZE\.upsert' && \
   ! git diff "$DIFF_BASE"...HEAD -- '*.js' 2>/dev/null | grep -q 'EMBED_DIMS'; then
  echo "  ! new VECTORIZE.upsert without EMBED_DIMS filter — confirm embedding dim check"; red=$((red+1))
fi

if [[ "$red" -eq 0 ]]; then
  echo "  ✓ no automated red flags"
fi

echo
echo "Next step: open each suggested skill's SKILL.md and follow its checklist."
exit 0
