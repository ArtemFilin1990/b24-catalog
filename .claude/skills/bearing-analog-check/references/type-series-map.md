# bearing type & series map

## ISO families → type

| Series | Type | Notes |
|---|---|---|
| 60xx, 62xx, 63xx, 64xx, 16xxx, 68xx, 69xx | Deep-groove ball (радиальный шариковый) | Most common; seal suffixes: ZZ/2Z, 2RS/RSR. |
| 70xx, 72xx, 73xx (+contact-angle codes A, B, C, E) | Angular-contact ball (радиально-упорный шариковый) | Contact angle letter is load-direction-critical; never dropped. |
| 22xxx, 23xxx | Spherical roller (сферический роликовый) | Designed for misalignment; E-class cage modernises old designs. |
| 30xxx, 31xxx, 32xxx, 33xxx | Tapered roller (конический) | Width is `T`, not `B`. Cone + cup + rollers assemblies. |
| NU, NJ, N, NF, NUP, NNU | Cylindrical roller (цилиндрический роликовый) | Letter codes define flange configuration; not interchangeable. |
| 51xxx – 54xxx | Thrust ball (упорный шариковый) | Single-direction (51) vs double-direction (52) — **never** cross. |
| 80xxx, 81xxx | Thrust roller (упорный роликовый) | |
| HK, BK, NA, RNA | Needle roller (игольчатый) | |

## ГОСТ (legacy Soviet) designation — type by the 4th-from-right digit

ГОСТ 3189-89 encodes the type in the first "class" digit (`0…9`) of the designation:

| Digit | Type |
|---|---|
| 0 | Deep-groove ball |
| 1 | Spherical ball (radial) |
| 2 | Cylindrical roller (short) |
| 3 | Spherical roller |
| 4 | Cylindrical roller (with cage) |
| 5 | Cylindrical roller (no cage / long roller) |
| 6 | Angular-contact ball |
| 7 | Tapered roller |
| 8 | Thrust ball |
| 9 | Thrust roller |

**Trap:** reading a ГОСТ number left-to-right can mislead. ГОСТ 6-204 is *not* ISO 6204. Use the class-digit table, not a coincidence of digits.

## ГОСТ ↔ ISO cross (stable subset)

| ГОСТ | ISO | Type |
|---|---|---|
| 180xxx (e.g. 180205) | 6205-2Z | Deep-groove ball, with shields |
| 160xxx (e.g. 160205) | 6205-2RS | Deep-groove ball, sealed |
| 7xxx ГОСТ tapered (e.g. 7510) | 32210 | Tapered roller |
| 3xxxx ГОСТ spherical roller (e.g. 3615) | 22315 | Spherical roller |
| 8xxxx ГОСТ thrust ball (e.g. 8205) | 51205 | Thrust ball |
| NJ / NU / N / NF (adopted) | same family in SKF / FAG / NSK | Cylindrical roller |

**Do not extend this table in a PR without a cited source** (ISO 15, ISO 355, ГОСТ 3189-89, ГОСТ 520, or a manufacturer interchange table). Prompt rules must reject unsourced cross-mappings.

## Traps to catch in review

1. **Deep-groove ball ↔ spherical ball** — digits 0 and 1 in ГОСТ are both "ball" but not interchangeable; spherical self-aligns, deep-groove does not.
2. **Single- vs double-direction thrust** — 51205 (single) vs 52205 (double). Replacing one with the other reverses or doubles the load path.
3. **Tapered `T` vs cylindrical `B`** — width letters differ; do not compare raw numbers.
4. **Contact angle suffix dropped** — 7205B and 7205C have different contact angles; never drop the suffix.
5. **Clearance implied vs stated** — if the user did not state clearance, assume CN. But if they did, carry it through every analog.
6. **Cage material / precision** — `M` (brass), `MA` (machined brass), `TN9` (polyamide) affect speed and temperature limits; keep same or flag change.

## When in doubt

`ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ` + list what is missing. The cost of escalating to a human manager is tiny. The cost of a wrong bearing in a running machine is not.
