#!/bin/sh
# Static secret-shape grep over the worker source. Exits non-zero on any hit.
# Run from repo root. Offline. No network, no secrets needed.
#
# Catches the shapes that have actually leaked here before:
#   - cfat_*  Cloudflare API tokens
#   - sk-*    OpenAI-style keys
#   - ghp_/gho_/github_pat_*  GitHub tokens
#   - 'Bearer ' literal followed by a long string
#   - lines like  password = '...'  / token = "..."  (case-insensitive,
#     skips ${...} template refs)
#
# KNOWN LIMITATION: this is a line-oriented grep. Multi-line literals
# like:
#     const TOKEN =
#       "literal-secret-here";
# slip past every rule below. A static line scan can't reliably catch
# them without massive false-positive rate. For paranoid coverage,
# layer a real secret scanner on top (gitleaks, trufflehog, GitHub's
# native secret scanning). This script is the cheap first line of
# defence, not the only one.

set -eu

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

fail=0

scan_pattern() {
  pattern="$1"
  label="$2"
  # Optional third arg: extra flags for grep (e.g. "-i" for case-insensitive
  # patterns where keys can be ALL_CAPS like API_KEY / TOKEN).
  extra="${3:-}"
  # Optional fourth arg: post-filter regex; matching lines are dropped.
  # Used by the key=value rule to skip shell template refs like
  # `TOKEN="${ADMIN_TOKEN:-}"` — those are variable substitutions, not
  # hardcoded literals.
  exclude="${4:-}"
  # Use null-delimited file list so paths containing whitespace are not
  # word-split by xargs. The repo convention forbids spaces in paths but
  # a fail-fast scanner should not silently drop a file just because
  # someone added one.
  # shellcheck disable=SC2086
  hits=$(find . \
      \( -name node_modules -o -name .git -o -name dist -o -name build \) -prune -o \
      -type f \( -name '*.js' -o -name '*.ts' -o -name '*.html' -o -name '*.css' \
               -o -name '*.json' -o -name '*.toml' -o -name '*.yml' -o -name '*.yaml' \
               -o -name '*.md' -o -name '*.sh' \) -print0 2>/dev/null \
    | xargs -0 grep -nE $extra -- "$pattern" 2>/dev/null \
    | grep -v -E '/(known-incidents|threat-model)\.md:' \
    | grep -v -E '/secret-scan\.sh:' || true)
  if [ -n "$exclude" ]; then
    hits=$(printf '%s\n' "$hits" | grep -v -E -- "$exclude" || true)
  fi
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
# Don't exclude $ from the value class — real secrets routinely contain
# $ (`password='Abcd$1234567890'`); excluding it created a bypass.
# Pass `-i` so ALL_CAPS variants like `API_KEY = "..."` / `TOKEN='...'`
# also match — credentials are routinely committed with uppercase keys.
scan_pattern "(password|passwd|secret|api_key|apikey|token)[[:space:]]*[:=][[:space:]]*[\"'][^\"']{12,}[\"']" \
                                            "key=value-style secret literal" "-i" '\$\{'

if [ "$fail" -ne 0 ]; then
  echo "FAIL: secret-shape matches above. Either rotate + remove, or add a justification comment if it's a fixture/example."
  exit 1
fi

echo "OK: no secret-shape matches in the worker source."
