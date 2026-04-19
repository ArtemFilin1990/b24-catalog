#!/usr/bin/env sh
set -eu

TARGET="${1:-migrations}"

echo "Review catalog import SQL in: $TARGET"
echo "1. Check clean DB bootstrap"
echo "2. Check upgrade safety"
echo "3. Check duplicate prevention in staging/view layers"
echo "4. Check stable unique identifiers in read models"
echo "5. Confirm invalid/quarantine rows are filtered from bot/search views"
