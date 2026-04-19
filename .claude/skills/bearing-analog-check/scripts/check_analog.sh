#!/usr/bin/env bash
# bearing-analog-check/scripts/check_analog.sh — offline helper that builds a review
# template for a given bearing designation. It never pretends to know the answer — it
# prints the decomposition slots that a human (or the bot) must fill in before stamping
# ПОДТВЕРЖДЕНО.
#
# Usage: bash .claude/skills/bearing-analog-check/scripts/check_analog.sh <designation> [brand]
# Example: bash .claude/skills/bearing-analog-check/scripts/check_analog.sh 6205-2RS SKF
set -eu

DESIGNATION="${1:-}"
BRAND="${2:-}"
if [ -z "$DESIGNATION" ]; then
  echo "usage: check_analog.sh <designation> [brand]"
  exit 2
fi

echo "== bearing-analog-check template for: $DESIGNATION${BRAND:+ ($BRAND)} =="
cat <<EOF

1) Decomposition
   Prefix (standard/brand-specific): ___
   Core (series + size code):        ___
   Suffixes (seal/clearance/cage/precision/lubricant): ___

2) Type (pick exactly one, cite source)
   [ ] Deep-groove ball        (ISO 60xx/62xx/63xx/64xx/16xxx/68xx/69xx ; ГОСТ class 0)
   [ ] Angular-contact ball    (ISO 70xx/72xx/73xx + A/B/C/E          ; ГОСТ class 6)
   [ ] Spherical roller        (ISO 22xxx/23xxx                       ; ГОСТ class 3)
   [ ] Tapered roller          (ISO 30xxx/31xxx/32xxx/33xxx           ; ГОСТ class 7)
   [ ] Cylindrical roller      (NU/NJ/N/NF/NUP/NNU                    ; ГОСТ class 2/4/5)
   [ ] Thrust ball             (ISO 51…54xxx                          ; ГОСТ class 8)
   [ ] Thrust roller           (ISO 80xxx/81xxx                       ; ГОСТ class 9)
   [ ] Needle                  (HK/BK/NA/RNA)
   Source for this classification: ___

3) Geometry (all three must be exact; no "close enough")
   d (bore mm):    ___
   D (OD mm):      ___
   B or T (mm):    ___   (use T for tapered roller, B otherwise)

4) Suffix integrity
   Seal class (ZZ / 2RS / open):  ___   matches source?  [ ] yes [ ] no / not specified
   Clearance  (CN / C2 / C3 / C4): ___   matches source?  [ ] yes [ ] no / not specified
   Precision  (P0 / P5 / P6 / P4): ___
   Cage       (M / MA / TN9 / …):  ___

5) Brand-specific data (fill only from a cited catalog row)
   Brand of source row: ___
   Catalog uid (from catalog_master_view): ___
   Mass (kg):   ___
   Dynamic C, static C0: ___
   Note: never copy mass / C / C0 across brands.

6) Commercial fields
   Price / stock / lead time:  «Требует подтверждения менеджером»  (do not fill here).

7) Verdict
   [ ] ПОДТВЕРЖДЕНО             — all of 1–5 match; cite catalog uid.
   [ ] ТРЕБУЕТ_ПРОВЕРКИ         — type + geometry + analog direction clear; one sub-field missing.
   [ ] ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ  — any of type/geometry/seal/clearance cannot be confirmed.
   [ ] ОТКЛОНЕНО                — out of scope or cross-type substitution requested.

8) Risk statement (one sentence, concrete)
   If wrong, consequence: ___

EOF

# Heuristic hint (purely informative — never a verdict by itself)
echo "Heuristic hint:"
case "$DESIGNATION" in
  [0-6][0-9][0-9][0-9]*|[0-6][0-9][0-9]*)    echo "  leading 6/4/16/60-69 → ISO deep-groove ball — CONFIRM with step 2.";;
  7[0-9][0-9][0-9]*)                          echo "  7xxx — ISO angular-contact ball — contact-angle suffix mandatory.";;
  22[0-9][0-9][0-9]*|23[0-9][0-9][0-9]*)      echo "  22xxx/23xxx — ISO spherical roller — never map to ball.";;
  3[0-3][0-9][0-9][0-9]*)                     echo "  30/31/32/33xxx — ISO tapered roller — width is T, not B.";;
  5[1-4][0-9][0-9][0-9]*)                     echo "  51…54xxx — ISO thrust ball — single vs double direction matters.";;
  NU*|NJ*|NF*|NUP*|NNU*|N[0-9]*)              echo "  NU/NJ/N/NF/NUP — cylindrical roller — flange config is not interchangeable.";;
  HK*|BK*|NA*|RNA*)                           echo "  HK/BK/NA/RNA — needle roller.";;
  180*|160*|170*)                             echo "  ГОСТ 18xxxx/16xxxx — probably deep-groove ball with shields/seals; confirm via ISO core.";;
  7[0-9][0-9][0-9])                           echo "  ГОСТ 4-digit 7xxx — probably tapered roller (class 7); verify with ГОСТ 3189-89.";;
  *)                                          echo "  pattern not recognised — do full decomposition in step 1.";;
esac

echo
echo "Reminder: dimensions alone NEVER justify a cross-type analog."
