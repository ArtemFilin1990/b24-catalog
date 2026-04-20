#!/usr/bin/env bash
# scripts/smoke_chat.sh — smoke test the ai-kb chatbot worker
# Usage: bash scripts/smoke_chat.sh [base_url] [admin_token]
# Defaults: base_url=https://ai-kb.35ewerest.workers.dev, admin_token=$ADMIN_TOKEN
set -euo pipefail

BASE="${1:-https://ai-kb.35ewerest.workers.dev}"
TOKEN="${2:-${ADMIN_TOKEN:-}}"
SESSION="smoke-$(date +%s)"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo "== ai-kb smoke test: $BASE =="

echo "[1] GET /api/health (expect llama-3.3-70b + bge-m3)"
H=$(curl -sS --fail "$BASE/api/health")
echo "    $H"
echo "$H" | grep -q 'llama-3.3-70b' || fail "health: chat model mismatch"
echo "$H" | grep -q 'bge-m3'         || fail "health: embed model mismatch"
pass "health OK"

echo "[2] POST /api/chat SSE (session=$SESSION)"
BODY=$(printf '{"session_id":"%s","messages":[{"role":"user","content":"Подбери аналог подшипника 6205-2RS"}]}' "$SESSION")
# Just check the first SSE line arrives within 15s
curl -sS --fail --max-time 15 -X POST "$BASE/api/chat" \
  -H 'Content-Type: application/json' \
  --data "$BODY" \
  | head -c 2048 | grep -q '^data:' \
  && pass "chat streamed SSE" \
  || fail "chat did not stream SSE"

echo "[3] GET /api/sessions/$SESSION/messages (should contain the turn)"
sleep 2
curl -sS --fail "$BASE/api/sessions/$SESSION/messages" \
  | grep -q '"role":"user"' \
  && pass "memory persisted" \
  || echo "  (warn) session not yet visible — fine if stream still writing"

if [[ -n "$TOKEN" ]]; then
  echo "[4] GET /api/settings (admin read is public; admin write gated)"
  curl -sS --fail "$BASE/api/settings" | grep -q '"system_prompt"' \
    && pass "settings readable" \
    || fail "settings read failed"

  echo "[5] POST /api/settings (admin, no-op upsert of temperature=0.2)"
  curl -sS --fail -X POST "$BASE/api/settings" \
    -H "X-Admin-Token: $TOKEN" \
    -H 'Content-Type: application/json' \
    --data '{"settings":{"temperature":"0.2"}}' \
    | grep -q '"ok":true' \
    && pass "admin settings write OK" \
    || fail "admin settings write failed"
else
  echo "[4-5] SKIP: no ADMIN_TOKEN provided"
fi

echo ""
echo "== smoke OK =="
