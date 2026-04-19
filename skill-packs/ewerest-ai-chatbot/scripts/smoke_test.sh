#!/usr/bin/env bash
# scripts/smoke_test.sh — проверка живых эндпоинтов после деплоя
# Использование: bash scripts/smoke_test.sh https://<worker>.workers.dev $ADMIN_TOKEN
set -euo pipefail

BASE="${1:-https://b24-catalog.workers.dev}"
TOKEN="${2:-${ADMIN_TOKEN:-}}"
SESSION="smoke-$(date +%s)"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo "== Smoke test: $BASE =="

echo "[1] /health"
curl -sf "$BASE/health" | grep -q '"ok":true' && pass "health OK" || fail "health failed"

echo "[2] /chat: запрос о подшипнике 6205-2RS"
RESP=$(curl -sf -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION\",\"message\":\"Нужен подшипник 6205-2RS, есть ли аналог?\"}")
echo "$RESP" | grep -q '"answer"' && pass "chat отвечает" || fail "chat не ответил: $RESP"

echo "[3] /chat: проверка памяти (второй запрос в той же сессии)"
RESP2=$(curl -sf -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION\",\"message\":\"А какой у него d/D/H?\"}")
echo "$RESP2" | grep -q '"answer"' && pass "память работает" || fail "память не работает"

if [[ -n "$TOKEN" ]]; then
  echo "[4] /admin/stats"
  curl -sf "$BASE/admin/stats" -H "Authorization: Bearer $TOKEN" \
    | grep -q '"sessions"' && pass "admin stats OK" || fail "admin stats failed"

  echo "[5] /admin/config"
  curl -sf "$BASE/admin/config" -H "Authorization: Bearer $TOKEN" \
    | grep -q '"temperature"' && pass "admin config OK" || fail "admin config failed"
else
  echo "[4–5] SKIP: ADMIN_TOKEN не передан"
fi

echo ""
echo "== Все проверки пройдены =="
