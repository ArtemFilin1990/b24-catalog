---
name: bearing-analog-check
description: Validate bearing analogs, type/series classification, geometry safety, and the "NO DIRECT EQUIV" decision whenever the Everest chatbot prompt, the catalog analog columns, or the bearing answer logic is reviewed or changed.
---

Use this skill when the PR:

- edits `AI_SYSTEM` in `ai-kb/src/index.js` (or sets `settings.system_prompt` in D1);
- changes `searchCatalog` / `catalogRowToText` / analog columns (`skf_analog`, `fag_analog`, `nsk_analog`, `ntn_analog`, `zwz_analog`);
- adds ГОСТ ↔ ISO mapping data in migrations, prompt, or admin UI;
- changes how the bot presents equivalents, sizes, or commercial data.

## Prime directive

The bot answers real customers ordering real bearings. A wrong analog = a broken machine. Default to **ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ** (`NO DIRECT EQUIV`) whenever any required fact is missing.

## Non-negotiables

1. **Exact type match.** Ball ≠ roller ≠ thrust ≠ tapered ≠ needle. Dimensions matching by coincidence never justify a cross-type substitute.
2. **Exact geometry match.** `d` (bore), `D` (OD), `B` or `T` (width/height) must all be equal. "Close enough" does not exist.
3. **Same seal class** when the user specified one (ZZ, 2RS, RS, open). Do not silently change it.
4. **Same clearance class** when the user specified one (C2, CN, C3, C4).
5. **Series informs type.** See `references/type-series-map.md`. Series digits alone are not enough when the number also matches a ГОСТ pattern for a different type — if ambiguous, ask.
6. **Mass and load ratings are brand-specific.** Never copy from one brand onto another's row.
7. **Commercial data** (цена, наличие, срок поставки) must be framed as "Требует подтверждения менеджером". The bot is not a price oracle.
8. **Status vocabulary is fixed**: `ПОДТВЕРЖДЕНО | ТРЕБУЕТ_ПРОВЕРКИ | ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ | ОТКЛОНЕНО`. Do not invent new statuses.

## Decomposition of a designation

Every reasoning step for analogs must pass through:

1. **Prefix** — standard or internal prefix (ГОСТ / bore-diameter code / brand-specific).
2. **Core** — series + size code.
3. **Suffixes** — seal (ZZ, 2RS), clearance (C3…), cage (M, MA, P6…), precision (P5, P6, P0), lubricant, heat treatment.

Only after all three are identified may the bot propose an analog. Missing any → ask the user or return `ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ`.

## Review flow (for PRs)

1. Open the changed prompt / mapping / analog column diff.
2. For each added rule or row:
   - Is it backed by a traceable source (ISO 15, ISO 355, ГОСТ 520, ГОСТ 3189, manufacturer catalog)?
   - Does it preserve type?
   - Does it preserve `d × D × B/T` exactly?
   - Does it preserve seal + clearance when the source specified them?
3. Re-run the prompt against the smoke prompts in `references/analog-rules.md` ("critical cases") mentally — any cross-type answer is a block.
4. Confirm the live prompt strategy is still consistent: `AI_SYSTEM` is the factory default; `settings.system_prompt` (D1 row) may override in prod. Changing only `AI_SYSTEM` without flushing the D1 override does not change runtime behavior.

## Output

Shared contract from `.claude/skills/README.md` (Decision / Why / Blocking fixes / Non-blocking / Merge recommendation). Add a fifth section for bearing reviews:

```
Risk if wrong: <concrete consequence — e.g. "thrust load on a deep-groove ball bearing will fail in hours">
```

## References

- `references/analog-rules.md` — mandatory rules, safe questions to ask the user, smoke prompts.
- `references/type-series-map.md` — ISO & ГОСТ series → type map with known traps.

## Scripts

- `scripts/check_analog.sh <designation> [brand]` — offline helper that prints the decomposition template and lists the facts the reviewer must confirm before stamping `ПОДТВЕРЖДЕНО`.
