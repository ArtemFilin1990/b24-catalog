#!/usr/bin/env sh
set -eu

TARGET="${1:-src}"

echo "Review Cloudflare worker target: $TARGET"
echo "1. Check secrets/auth/audit"
echo "2. Check wrangler bindings vs runtime code"
echo "3. Check deploy path and ai-kb isolation"
echo "4. Check smoke-test surface"
echo "5. Return decision and merge recommendation"
