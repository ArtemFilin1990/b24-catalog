// src/prompt.js — сборка system prompt и messages для Workers AI

const DEFAULT_SYSTEM_PROMPT = `Ты — AI-ассистент ООО «Эверест» (B2B оптовая поставка подшипников, г. Вологда, ewerest.ru).

РОЛЬ: помогать клиентам и менеджерам с подбором подшипников, аналогами, характеристиками, условиями поставки.

ПРАВИЛА ПО ПОДШИПНИКАМ (строго соблюдать):
1. Отделяй базовый номер от префиксов/суффиксов (2RS, ZZ, C3, K, N, NR, P6, P5, P4, M, TN, E).
2. Аналог ГОСТ⇄ISO валиден ТОЛЬКО при полном совпадении: тип + серия + геометрия (d/D/B) + исполнение.
3. Если полного совпадения нет — пиши "NO DIRECT EQUIV".
4. Непроверенные данные — "[[TBD]] + где проверить".
5. Источник приоритета: оф. каталог производителя → стандарт → тех. каталог → вторичный сайт.

ФОРМАТ КАРТОЧКИ:
- Идентификация (part number + бренд)
- Параметры (d / D / H, исполнение, класс, зазор)
- Аналоги (ГОСТ⇄ISO при совпадении геометрии, иначе NO DIRECT EQUIV)
- Контакты (info@ewerest.ru, наб. Пречистенская 72, Вологда)

СТИЛЬ:
- Коротко, по делу.
- Русский язык.
- Не выдумывай характеристики. Если не знаешь — "[[TBD]]".
- Используй данные из блоков CONTEXT и CATALOG ниже как приоритетный источник.`;

export async function buildSystemPrompt(env, cfg, { ragContext, bearingContext }) {
  const base = cfg.system_prompt || DEFAULT_SYSTEM_PROMPT;
  const parts = [base];

  if (ragContext?.text) {
    parts.push(`\n\n=== CONTEXT (база знаний) ===\n${ragContext.text}\n=== END CONTEXT ===`);
  }

  if (bearingContext?.item) {
    const it = bearingContext.item;
    parts.push(
      `\n\n=== CATALOG HIT ===\n` +
        `Part: ${it.part_number} | Brand: ${it.brand}\n` +
        `d=${it.d} D=${it.D} H=${it.H} | Exec: ${it.execution || "—"} | Clearance: ${it.clearance || "—"}\n` +
        `Analog ГОСТ: ${it.analog_gost || "NO DIRECT EQUIV"}\n` +
        `Analog ISO: ${it.analog_iso || "NO DIRECT EQUIV"}\n` +
        `=== END CATALOG ===`
    );

    if (bearingContext.analogs?.length) {
      const lines = bearingContext.analogs
        .map((a) =>
          a.note ? `- ${a.note} (${a.reason || ""})` : `- ${a.part_number} (${a.brand}) d=${a.d} D=${a.D} H=${a.H}`
        )
        .join("\n");
      parts.push(`\n\n=== ANALOGS ===\n${lines}\n=== END ANALOGS ===`);
    }
  }

  return parts.join("");
}

export function buildMessages(systemPrompt, history, userMessage) {
  return [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];
}
