#!/bin/sh
# Static secret-shape grep over the worker source. Exits non-zero on any hit.
# Run from repo root. Offline. No network, no secrets needed.
#
# Catches the shapes that have actually leaked here before:
#   - cfat_*  Cloudflare API tokens
#   - sk-*    OpenAI-style keys
#   - ghp_/gho_/github_pat_*  GitHub tokens
#   - 'Bearer ' literal followed by a long string
#   - lines like  password = '...'  / token = "..."

set -eu

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Files we care about (exclude node_modules, build artefacts, the skill's own
# rules-of-thumb files, and binary-ish locations).
FILES=$(find . \
  \( -name node_modules -o -name .git -o -name dist -o -name build \) -prune -o \
  -type f \( -name '*.js' -o -name '*.ts' -o -name '*.html' -o -name '*.css' \
           -o -name '*.json' -o -name '*.toml' -o -name '*.yml' -o -name '*.yaml' \
           -o -name '*.md' -o -name '*.sh' \) -print)

fail=0

scan_pattern() {
  pattern="$1"
  label="$2"
  # shellcheck disable=SC2086
  hits=$(echo "$FILES" | xargs grep -nE -- "$pattern" 2>/dev/null \
    | grep -v -E '\.claude/skills/security-engineer/' \
    | grep -v -E '/(known-incidents|threat-model)\.md:' || true)
  if [ -n "$hits" ]; then
    echo "[$label]"
    echo "$hits"
    echo
    fail=1
  fi
}

scan_pattern 'cfat_[A-Za-z0-9]{16,}'       "Cloudflare API token (cfat_*)"
scan_pattern '\bsk-[A-Za-z0-9_-]{20,}'      "OpenAI-style secret key (sk-*)"
scan_pattern '\bghp_[A-Za-z0-9]{20,}'       "GitHub personal token (ghp_*)"
scan_pattern '\bgho_[A-Za-z0-9]{20,}'       "GitHub OAuth token (gho_*)"
scan_pattern '\bgithub_pat_[A-Za-z0-9_]{20,}' "GitHub fine-grained PAT"
scan_pattern 'Bearer [A-Za-z0-9._-]{32,}'   "Bearer literal in source"
# grep -E treats \x27 inside a character class as the literal characters
# x, 2, 7 — NOT as ASCII 0x27 (single quote). Use double-quoted shell
# string and put the literal ' character directly into the bracket
# expression so single-quoted secrets like token='...' actually match.
scan_pattern "(password|passwd|secret|api_key|apikey|token)[[:space:]]*[:=][[:space:]]*[\"'][^\"'\$]{12,}[\"']" \
                                            "key=value-style secret literal"

if [ "$fail" -ne 0 ]; then
  echo "FAIL: secret-shape matches above. Either rotate + remove, or add a justification comment if it's a fixture/example."
  exit 1
fi

echo "OK: no secret-shape matches in the worker source."
