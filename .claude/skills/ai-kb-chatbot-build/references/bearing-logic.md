# Bearing answer logic in the chatbot

Bearing correctness is delegated to two places working together:

1. **Prompt rules** baked into `AI_SYSTEM` (the constant) or overridden by `settings.system_prompt` in D1 — enforces type/series discipline at generation time.
2. **Review rules** in the `.claude/skills/bearing-analog-check` skill — enforces the same at review time for any PR touching bearing answers or analog tables.

When in doubt about an analog, the bot must emit `ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ` / `NO DIRECT EQUIV` rather than guess.

## Non-negotiables (both prompt and reviewer)

- **Type match is mandatory.** Ball ≠ roller ≠ thrust ≠ tapered, even if `d×D×B` happens to match.
- **Series informs type.** ISO 6xxx is ball-radial; ГОСТ 4-digit 6xxx is conical-roller — never treat them as equivalent just because the leading digits coincide. At most, ask the user to disambiguate.
- **Geometry equality is strict** (`d = ? AND D = ? AND B = ?`) — no "close enough".
- **Mass and clearance are brand+execution-specific** — never copy mass from one brand onto another brand's row.
- **Commercial data** (цена, наличие, срок) — always "Требует подтверждения менеджером".

## How the prompt is structured (`ai-kb/src/index.js` constant `AI_SYSTEM`)

Sections, in order:
1. Роль (инженер-эксперт ТД «Эверест»).
2. Логика подбора (нормализация → тип по серии → размеры по ISO 15 / ISO 355 → тот же тип → подставляй ГОСТ только из таблицы).
3. ISO/ГОСТ таблицы серий.
4. Кросс-таблица ГОСТ↔ISO.
5. Формат ответа (Итог → Данные аналогов → Комментарий → Статус).
6. Коммерческая граница.

When editing the prompt:
- Do **not** add bare cross-reference pairs without a geometry check.
- Do **not** invite the model to "propose a similar size". Users read bot output as committed substitutions.
- Keep the status vocabulary exactly: `ПОДТВЕРЖДЕНО | ТРЕБУЕТ_ПРОВЕРКИ | ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ | ОТКЛОНЕНО`.

## How catalog hits reach the answer

`searchCatalog` returns rows from `catalog` (real columns: `base_number, brand, type, d_inner, d_outer, width_mm, skf_analog, fag_analog, nsk_analog, ntn_analog, zwz_analog, seal, clearance, price_rub, qty`). `catalogRowToText` flattens each row into one Russian sentence fed into `Контекст:`. The LLM uses this as primary evidence; if it's missing, the model may only hint at a product, never commit.

## When to call the sibling skill

Load `.claude/skills/bearing-analog-check` whenever you:
- edit `AI_SYSTEM`;
- change `searchCatalog`, `catalogRowToText`, or the `catalog` table shape;
- review a PR that adds/changes ГОСТ↔ISO mappings in prompt, migrations, or admin UI.

Its `references/analog-rules.md` and `references/type-series-map.md` are the authoritative checklists.
