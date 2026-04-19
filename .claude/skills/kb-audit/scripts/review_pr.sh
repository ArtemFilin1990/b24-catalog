#!/usr/bin/env sh
set -eu

PR_NUMBER="${1:-}"

if [ -z "$PR_NUMBER" ]; then
  echo "usage: review_pr.sh <pr-number>"
  exit 1
fi

echo "Review PR #$PR_NUMBER with kb-audit"
echo "1. Inspect changed files and scope"
echo "2. Check bootstrap safety on clean D1"
echo "3. Check upgrade safety on existing D1"
echo "4. Look for duplicate logical rows / ID collisions / vector ID collisions"
echo "5. Return: APPROVE / APPROVE WITH FIXES / REQUEST CHANGES"
