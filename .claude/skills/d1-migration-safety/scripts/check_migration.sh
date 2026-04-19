#!/usr/bin/env sh
set -eu

TARGET="${1:-ai-kb/migrations}"

echo "Check D1 migrations in: $TARGET"
echo "1. Validate clean DB bootstrap safety"
echo "2. Validate existing DB upgrade safety"
echo "3. Check helper-table dependencies"
echo "4. Check duplicate logical rows / id collisions in views"
echo "5. Return blockers, non-blockers, and migration order"
