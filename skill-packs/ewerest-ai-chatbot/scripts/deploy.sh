#!/usr/bin/env bash
# scripts/deploy.sh — разворачивание ewerest-ai-chatbot на Cloudflare
# Требования: wrangler >= 3.90, node >= 20, аутентификация (wrangler login или CLOUDFLARE_API_TOKEN)
set -euo pipefail

WORKER_NAME="${WORKER_NAME:-b24-catalog}"
D1_NAME="${D1_NAME:-b24-catalog-db}"
KB_INDEX="${KB_INDEX:-ewerest-kb}"
CATALOG_INDEX="${CATALOG_INDEX:-ewerest-catalog}"
R2_BUCKET="${R2_BUCKET:-vedro}"
EMBED_DIM="${EMBED_DIM:-1024}"   # bge-m3 = 1024

cd "$(dirname "$0")/.."

echo "== [1/6] Проверка wrangler =="
npx wrangler --version

echo "== [2/6] Vectorize indexes =="
if ! npx wrangler vectorize list 2>/dev/null | grep -q "\b${KB_INDEX}\b"; then
  echo "создаю $KB_INDEX (dim=$EMBED_DIM, cosine)"
  npx wrangler vectorize create "$KB_INDEX" --dimensions="$EMBED_DIM" --metric=cosine
else
  echo "$KB_INDEX уже существует — пропускаю"
fi

if ! npx wrangler vectorize list 2>/dev/null | grep -q "\b${CATALOG_INDEX}\b"; then
  echo "создаю $CATALOG_INDEX (dim=$EMBED_DIM, cosine)"
  npx wrangler vectorize create "$CATALOG_INDEX" --dimensions="$EMBED_DIM" --metric=cosine
else
  echo "$CATALOG_INDEX уже существует — пропускаю"
fi

echo "== [3/6] R2 bucket =="
if ! npx wrangler r2 bucket list 2>/dev/null | grep -q "\b${R2_BUCKET}\b"; then
  echo "создаю bucket $R2_BUCKET"
  npx wrangler r2 bucket create "$R2_BUCKET"
else
  echo "$R2_BUCKET уже существует — пропускаю"
fi

echo "== [4/6] D1 миграция =="
npx wrangler d1 execute "$D1_NAME" --remote --file=scripts/d1_schema.sql

echo "== [5/6] Секрет ADMIN_TOKEN =="
if ! npx wrangler secret list 2>/dev/null | grep -q "ADMIN_TOKEN"; then
  echo "ADMIN_TOKEN не найден. Задай его: npx wrangler secret put ADMIN_TOKEN"
  echo "(скрипт продолжится без этого — но /admin/* будет недоступен)"
fi

echo "== [6/6] Deploy =="
npx wrangler deploy

echo ""
echo "Готово. Проверь:"
echo "  curl https://${WORKER_NAME}.<subdomain>.workers.dev/health"
echo "  bash scripts/smoke_test.sh https://${WORKER_NAME}.<subdomain>.workers.dev \$ADMIN_TOKEN"
