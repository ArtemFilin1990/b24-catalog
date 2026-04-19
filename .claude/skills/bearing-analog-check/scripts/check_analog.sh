#!/usr/bin/env sh
set -eu

DESIGNATION="${1:-}"

if [ -z "$DESIGNATION" ]; then
  echo "usage: check_analog.sh <designation>"
  exit 1
fi

echo "Check analog for: $DESIGNATION"
echo "1. Normalize designation"
echo "2. Identify exact type and series"
echo "3. Validate exact geometry"
echo "4. If not confirmed -> NO DIRECT EQUIV"
echo "5. State risks of a wrong substitute"
