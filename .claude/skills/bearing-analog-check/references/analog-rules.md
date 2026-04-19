# bearing-analog-check — mandatory rules

## Rules (apply in order)

1. **Confirm the type first.** Deep-groove ball, angular-contact ball, spherical roller, tapered roller, cylindrical roller, thrust ball, thrust roller, needle. If the designation is ambiguous (e.g. ГОСТ 6-4-digit vs ISO 6xxx), ask.
2. **Confirm geometry exactly.** `d`, `D`, `B` (or `T` for tapered). No rounding, no "similar size".
3. **Confirm seal class** if the user specified one. ZZ → ZZ / 2Z, 2RS → 2RS / RSR / DDU (per brand glossary). Do not drop seals.
4. **Confirm clearance** if specified. CN is implicit; C2, C3, C4, C5 are not interchangeable.
5. **Confirm precision class** when the application is machine-tool or high-speed — P0/P6/P5/P4/P2.
6. **Brand-map last.** Only after 1–5 are locked, map the SKF/FAG/NSK/NTN/ZWZ analog via the catalog row or the prompt's ГОСТ↔ISO table. Never invent a mapping.
7. **Mass & dynamic/static load ratings stay brand-specific.** If the source row has them, cite the source brand. Never copy across brands.
8. **Commercial fields** (price, stock, lead time) → always: «Требует подтверждения менеджером».

## Safe questions to ask the user

When any of 1–5 is missing:

- «Уточните обозначение полностью (префикс + серия + суффиксы: уплотнение, зазор, сепаратор, класс точности).»
- «Какие внутренний ⌀ d, наружный ⌀ D и ширина B (или высота T для конических)?»
- «Какой класс уплотнения — открытый, ZZ, 2RS?»
- «Какой зазор — CN (обычный), C3, C4?»
- «Какая область применения — редуктор, электродвигатель, шпиндель, вентилятор?»

## Status vocabulary (strict)

| Status | Meaning |
|---|---|
| `ПОДТВЕРЖДЕНО` | Type, geometry, seal, clearance, source — все проверено на конкретной строке каталога или в цитируемом источнике. |
| `ТРЕБУЕТ_ПРОВЕРКИ` | Направление верное, но одно из полей требует подтверждения (обычно у менеджера). |
| `ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ` | Среди SKF/FAG/NSK/NTN/ZWZ нет строго совпадающей позиции; предложить ближайшие варианты с оговоркой. |
| `ОТКЛОНЕНО` | Запрос не по подшипникам / не хватает критичных данных / запрещенная подмена типа. |

## Critical smoke prompts (mental tests before merging a prompt change)

1. «Подбери аналог 6205-2RS C3» — ball radial, ZZ must not appear as an answer; C3 must be preserved.
2. «Нужен 32210 вместо 7510» — both tapered roller; geometry must match exactly, otherwise `ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ`.
3. «Есть ли аналог 180205» (ГОСТ 3-digit + 3-digit suffix) — bot must decompose: `6205-2Z` is the ISO equivalent. If the model substitutes a roller bearing, block the PR.
4. «Цена на SKF 6305» — must answer: «Коммерческие данные (цена/наличие/срок) уточняйте у менеджера.»
5. «Подскажи 22315 E1 C3» — spherical roller; never map to a deep-groove ball of 22315-lookalike dimensions.

If any of these produces a wrong-type or wrong-geometry answer after the PR, the change is `REQUEST CHANGES`.

## Output discipline

- Separate **confirmed** from **assumed**. Confirmed is backed by a catalog row or a cited ГОСТ/ISO table.
- State **what is missing** for confirmation.
- State **risk** of a wrong substitute in one concrete sentence, not a generic warning.
- State **safe recommendation** at the end: either a specific analog with status `ПОДТВЕРЖДЕНО`, or `ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ` + what the user should tell the manager.
