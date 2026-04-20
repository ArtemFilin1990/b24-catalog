#!/usr/bin/env bash
# cloudflare-worker-review/scripts/review_worker.sh — static checks for the worker invariants.
# Usage: bash .claude/skills/cloudflare-worker-review/scripts/review_worker.sh
# No network; runs against files on disk.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "== cloudflare-worker-review static checks =="
red=0
warn=0
fail() { echo "  ✗ $1"; red=$((red+1)); }
note() { echo "  ! $1"; warn=$((warn+1)); }
ok()   { echo "  ✓ $1"; }

echo "[1] Hardcoded tokens"
if grep -rnE '(ADMIN_TOKEN|UPLOAD_TOKEN|X-Admin-Token)\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{8,}' \
        --include='*.js' --include='*.toml' --include='*.yml' --include='*.html' \
        src ai-kb/src ai-kb/public wrangler.toml ai-kb/wrangler.toml .github/workflows 2>/dev/null \
     | grep -vE 'env\.|secrets\.|process\.env|sessionStorage|"ai-kb-admin"|"ev_admin_token"'; then
  fail "possible hardcoded token"
else
  ok "no hardcoded tokens"
fi

echo "[2] Root safeEqual usage"
if grep -n 'safeEqual' src/index.js >/dev/null; then
  ok "src/index.js uses safeEqual"
else
  fail "safeEqual missing from src/index.js (constant-time compare)"
fi

echo "[3] requireUpload scope (must only gate /api/admin/upload-catalog)"
uses=$(grep -nE 'requireUpload\(' src/index.js || true)
if [[ -z "$uses" ]]; then
  note "requireUpload not referenced — unexpected; verify admin-upload route still exists"
else
  # Report all usages so reviewer can confirm they are inside the upload-catalog branch.
  echo "$uses" | sed 's/^/    /'
fi

echo "[4] Admin audit coverage"
admin_hits=$(grep -c 'requireAdmin(request, env)' src/index.js || true)
audit_hits=$(grep -c 'ctx\.waitUntil(audit(' src/index.js || true)
echo "    src/index.js: requireAdmin=$admin_hits  audit=$audit_hits"
if (( audit_hits < admin_hits - 2 )); then
  note "root worker: fewer audit() calls than requireAdmin checks — confirm every admin write logs"
fi

echo "[5] ai-kb auth shape"
if grep -nE 'function\s+requireAdmin' ai-kb/src/index.js >/dev/null; then
  ok "ai-kb has its own requireAdmin"
else
  note "ai-kb requireAdmin not found — re-read SKILL.md"
fi
if grep -nE 'function\s+requireAdmin' ai-kb/src/index.js | xargs -I{} echo {} >/dev/null 2>&1; then
  # Look at the requireAdmin body (≈10 lines after the signature) for safeEqual adoption.
  line=$(grep -nE 'function\s+requireAdmin' ai-kb/src/index.js | head -1 | cut -d: -f1)
  if [[ -n "$line" ]] && sed -n "$line,$((line+15))p" ai-kb/src/index.js | grep -q 'safeEqual'; then
    note "ai-kb adopted safeEqual — confirm intentional (historically it uses ===)"
  fi
fi

echo "[6] Runtime CREATE TABLE in worker code (grandfather: ensureSettingsTable only)"
# Find every CREATE TABLE in .js files, then exempt matches that live inside a function
# whose name contains "ensureSettingsTable" OR that create the grandfathered "settings" table.
bad=$(grep -nE 'CREATE TABLE' src/*.js ai-kb/src/*.js 2>/dev/null || true)
if [[ -n "$bad" ]]; then
  filtered=""
  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    file=${match%%:*}
    rest=${match#*:}
    lno=${rest%%:*}
    # Exempt comments
    if echo "$match" | grep -qE ':\s*//'; then continue; fi
    # Exempt the grandfathered settings table by name
    if echo "$match" | grep -qi 'CREATE TABLE IF NOT EXISTS settings\b'; then continue; fi
    # Exempt lines inside an ensureSettingsTable function body (search 10 lines back)
    start=$((lno>10?lno-10:1))
    if sed -n "${start},${lno}p" "$file" 2>/dev/null | grep -q 'ensureSettingsTable'; then continue; fi
    filtered+="$match"$'\n'
  done <<<"$bad"
  if [[ -n "${filtered//[[:space:]]/}" ]]; then
    echo "$filtered" | sed 's/^/    /'
    fail "runtime CREATE TABLE outside ensureSettingsTable — move to migrations/"
  else
    ok "no runtime CREATE TABLE outside grandfathered helper"
  fi
else
  ok "no runtime CREATE TABLE anywhere"
fi

echo "[7] Frontend admin token storage"
if grep -nE "localStorage\\.[sg]etItem\\(['\"](ai-kb-admin|ev_admin_token)" \
      ai-kb/public/app.js public/index.html 2>/dev/null; then
  fail "admin token written to localStorage — must be sessionStorage"
else
  ok "admin tokens stay in sessionStorage"
fi

echo "[8] Wrangler bindings sanity"
for f in wrangler.toml ai-kb/wrangler.toml; do
  [[ -f "$f" ]] || { note "$f missing"; continue; }
  # Both single- and double-quoted TOML strings are valid
  if ! grep -qE "database_id\\s*=\\s*['\"]11a157a7-c3e0-4b6b-aa24-3026992db298['\"]" "$f"; then
    fail "$f: D1 id drifted"
  fi
  if ! grep -qE "bucket_name\\s*=\\s*['\"]vedro['\"]" "$f"; then
    fail "$f: R2 bucket drifted"
  fi
  # R2 binding is named CATALOG in both workers
  if ! grep -qE "binding\\s*=\\s*['\"]CATALOG['\"]" "$f"; then
    fail "$f: R2 binding name drifted (expected 'CATALOG')"
  fi
done
if [[ -f ai-kb/wrangler.toml ]]; then
  grep -qE "index_name\\s*=\\s*['\"]ai-kb-index['\"]" ai-kb/wrangler.toml || fail "ai-kb/wrangler.toml: Vectorize index drifted"
fi

echo "[9] deploy-ai-kb.yml invariants"
wf=.github/workflows/deploy-ai-kb.yml
if [[ -f "$wf" ]]; then
  grep -q 'wrangler@4\.83\.0'           "$wf" || fail "$wf: wrangler@4.83.0 pin missing"
  grep -q 'accounts/.*/tokens/verify'   "$wf" || fail "$wf: account-scoped token verify missing"
  grep -q 'Бот Эверест'                 "$wf" || fail "$wf: title smoke check missing"
  grep -q 'llama-3.3-70b'               "$wf" || fail "$wf: health smoke check missing"
  grep -qE 'sleep (30|60|90|120|150|180)' "$wf" || note "$wf: retry/backoff steps not detected — confirm retry loop is intact"
fi
grep -q 'paths-ignore:\s*$' .github/workflows/deploy.yml 2>/dev/null || \
  grep -q 'paths-ignore:' .github/workflows/deploy.yml 2>/dev/null && ok "deploy.yml uses paths-ignore" || note "deploy.yml paths-ignore rule missing/changed"

echo
if (( red == 0 )); then
  echo "OK — $warn warnings"
else
  echo "FAIL — $red red, $warn warnings"
  exit 1
fi
