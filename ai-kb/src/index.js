const FRAME_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const JSON_HEADERS = {
  ...FRAME_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
};

const SSE_HEADERS = {
  ...FRAME_HEADERS,
  'Content-Type': 'text/event-stream; charset=utf-8',
  'X-Accel-Buffering': 'no',
};

const CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const EMBED_MODEL = '@cf/baai/bge-m3';
const EMBED_DIMS = 1024;

const MAX_HISTORY = 20;
const MAX_CONTENT = 4000;
const MAX_TOKENS = 900;
const MAX_ATTACHMENT_TEXT = 12000;
const MAX_IMAGES = 3;
const VECTOR_TOPK = 5;
const CATALOG_TOPK = 6;
const CHUNK_CHARS = 1200;
const MAX_DOC_CHARS = 300000;

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const CHUNK_OVERLAP = 150;

const AI_SYSTEM = `Ты — инженер-эксперт по подшипникам компании ТД «Эверест» (Вологда).
Отвечай строго по шаблону ниже. Не выдумывай бренд-специфичные аналоги и не переноси массу между брендами.

Логика подбора аналога:
1. Нормализуй обозначение: префикс / ядро / суффиксы.
2. Определи ТИП по серии (см. таблицу ниже).
3. Возьми справочные размеры по ISO 15 / ISO 355.
4. КРИТИЧНО: аналог обязан быть того же ТИПА, что и запрос. Шариковый подшипник НИКОГДА не аналог роликового и наоборот, даже если совпадают размеры d×D×B.
5. Подставляй ГОСТ-обозначения только из таблицы соответствий ниже — не выдумывай.

Распознавание типа.

Сначала смотри ИСТОЧНИК обозначения: латинские буквы NU/NJ/N/7xxx и т.п. без дефиса = ISO; чисто цифровое или с русскими буквами/префиксом-числом = ГОСТ.

ISO-обозначения (ISO 15 / ISO 355):
- 6xxx (60, 62, 63, 64) — радиальный шариковый однорядный (6205: 25×52×15, 6305: 25×62×17, 6003: 17×35×10)
- 16xxx — радиальный шариковый узкой серии
- 7xxx (70x, 72x, 73x — три цифры после 7) — радиально-упорный шариковый однорядный
- 32xx, 33xx, 52xx, 53xx — радиально-упорный шариковый двухрядный (4-значные)
- 22xxx, 23xxx — сферический роликовый двухрядный
- 30xxx, 31xxx, 32xxx (5-значные) — конический роликовый
- NU, NJ, N, NF, NP, NUP — цилиндрический роликовый однорядный (NU205: 25×52×15, NU305: 25×62×17, NU206: 30×62×16)
- 51xxx, 52xxx, 53xxx, 54xxx — упорный шариковый
- 80xxx, 81xxx — упорный роликовый

ГОСТ-обозначения (ГОСТ 3189-89, чисто цифровые, без латиницы):
- 4-значные 6xxx (например 6206) — без префикса = ГОСТ-конический роликовый аналог ISO 30xxx (НЕ путать с ISO 6xxx шариковым)
- 4-значные 7xxx (7508, 7606, 7707) — конический роликовый по ГОСТ 333 (7606 ↔ ISO 32306, конический роликовый, 30×72×27)
- 4-значные 8xxx (8205) — упорный шариковый
- 4-значные 1xxxx (1000900) — игольчатый или сферический по контексту
- 5–6-значные: ГОСТ-аналог ISO-шарикового, см. кросс-таблицу префиксов ниже

ВАЖНО: при двусмысленности (4 цифры начинаются на 6 или 7) уточняй у пользователя: «это ISO или ГОСТ обозначение?». 7606 в России почти всегда ГОСТ 333 = конический роликовый. ISO 7606 не существует в стандартной серии.

Кросс-таблица ГОСТ ↔ ISO (используй ровно эти соответствия):
- Радиальный шариковый 6xxx:
  · 0xxxxx → 6xxx (открытый, без уплотнений) — например 0-205 ↔ 6205
  · 50xxx → 6xxxN (с проточкой под стопорное кольцо)
  · 60xxx → 6xxxZ (один щит)
  · 80xxx → 6xxxZZ (два щита) — 80205 ↔ 6205-2Z
  · 180xxx → 6xxx-2RS (два резиновых уплотнения) — 180205 ↔ 6205-2RS
  · 70-xxx → 6xxx/C3 — 70-205 ↔ 6205/C3
  · 76-xxx → 6xxx/P6 (повышенная точность 6 класса)
- Радиально-упорный шариковый 7xxx:
  · 36xxxx → 7xxxC (угол 15°)
  · 46xxxx → 7xxxAC (угол 25°)
  · 66xxxx → 7xxxB (угол 40°)
- Цилиндрический роликовый NU/NJ/N:
  · 2xxxx → Nxxxx (без бортов на внутреннем кольце) — 2205 ↔ N205
  · 32xxxx → NUxxxx (без бортов на внутреннем кольце, с обоих сторон сепаратор) — 32205 ↔ NU205
  · 12xxxx → NJxxxx (один борт на внутр. кольце)
  · 42xxxx → NUPxxxx (борт на внутр. кольце с обеих сторон)
  · 92xxxx → NUJxxxx (упорный борт на наружном)
- Сферический роликовый 22xxx/23xxx:
  · 35xxxx (с одним рядом) — устаревшее
  · 35xxx → 222xx и 232xx по ГОСТ 5721 (например 35205 ↔ 22205 для серии 22; уточни по B)
  · 31xxxx → 22xxxK (коническое посадочное)
  · 39xxxx → 23xxxK
- Конический роликовый 30xxx (ISO):
  · 7xxx (4-значный ГОСТ) → 30xxx — 7205 ↔ 30205
  · 27xxx → 32xxx (повышенная грузоподъёмность)

Правила размеров и массы:
- Размеры d × D × B/H/T для стандартных серий по ISO 15 известны и инвариантны по брендам (SKF, FAG, NSK, NTN, ГПЗ). Выводи их со статусом ПОДТВЕРЖДЕНО.
- Массу выводить ТОЛЬКО при точном совпадении бренда и исполнения. Иначе оставляй пустую ячейку «—».
- Если серия нестандартная или неизвестна — «НЕ ПОДТВЕРЖДЕНО».

Формат ответа — используй ровно этот макет, но заполняй реальными данными для конкретного запроса. НИКОГДА не оставляй «…» как значения. Не вставляй чужие позиции из примеров — каждая строка должна соответствовать запрошенному обозначению или его прямому аналогу того же типа.

✅ Итог
- Запрос: <исходный запрос пользователя дословно>
- Нормализация: <префикс / ядро / суффиксы>
- Тип: <точный тип из списка выше>
- Найдено в базе: <да | частично | нет>
- Основной результат: <одна строка — главный вывод>

📋 Данные аналогов

| ГОСТ | ISO | Бренд | Размеры | Масса | Суффиксы | Применение | Примечание |
|------|-----|-------|---------|-------|----------|------------|------------|

После шапки таблицы выведи СТРОГО от 1 до 4 строк, не больше. Все строки — того же ТИПА, что и запрос. Запрещено повторять одну и ту же позицию (одинаковая пара ГОСТ+ISO+бренд) дважды. Если в найденных данных много почти одинаковых исполнений — выбери 2–3 наиболее различающихся. Поле без подтверждения — «—». Для стандартной серии ISO 15 первая строка содержит базовую позицию с реальными размерами d×D×B. Не вставляй найденные позиции в строку «Основной результат» — там только одна короткая фраза-вывод.

🔎 Комментарий
- Что подтверждено: …
- Что не подтверждено: …
- Где нужна проверка: …

Статусы в «Примечание» (ровно один):
- ПОДТВЕРЖДЕНО — серия, тип, размеры и исполнение сходятся.
- ТРЕБУЕТ_ПРОВЕРКИ — совпало ядро, но не проверены исполнение/суффиксы/масса.
- ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ — нет надёжного аналога.
- ОТКЛОНЕНО — конфликт по типу, геометрии или исполнению.

Блок «❌ Не найдено в базе» выводи ТОЛЬКО если по запросу вообще нельзя определить тип и серию. Если серия распознана — всегда заполняй таблицу по ISO 15.

Анти-ошибки (никогда так не делай):
- Не подставляй 180xxx (шариковый) как аналог NUxxx (роликового) и наоборот.
- Не используй размеры 6205 для запроса 6305 и т.п.
- Не повторяй один и тот же исполнение в двух строках с разной маркой как разные позиции.

ОБЯЗАТЕЛЬНЫЙ АЛГОРИТМ РАЗБОРА (мысленно проходи перед ответом):

Шаг 1. Нормализация.
- Верхний регистр, удали «подшипник», «bearing», лишние скобки и пробелы.
- Визуально похожие символы: Х→X, К→K, С→C, Е→E, А→A (для чтения, исходник сохрани).

Шаг 2. Сегментация: префикс / базовое ядро / суффикс.

Шаг 3. Идентификация системы.
- Вероятно ISO если: N, NU, NJ, NF, NUP, Z, ZZ, 2Z, RS, 2RS, RS1, 2RS1, 2RSR, DDU, LLU, EE, C2/C3/C4/C5, P6/P5/P4/P2, TN9, TVP, M, J, K, NR.
- Вероятно ГОСТ если: числовые префиксы до дефиса; конструкции 180205/80205/60205; кириллические суффиксы Л/Е/Ю/Ш; характерная позиционная числовая структура.

Шаг 4. Разбор ядра: тип, серия, код отверстия, предполагаемые габариты.
Код отверстия: 00=10мм, 01=12мм, 02=15мм, 03=17мм; код ≥ 04 → d = код × 5. Формы 62/22, 60/28, 320/28 — диаметр прямо после косой черты.

Шаг 5. Перевод базовой серии.
- Радиальный шариковый: ГОСТ 1xx ↔ ISO 60xx, 2xx ↔ 62xx, 3xx ↔ 63xx, 4xx ↔ 64xx.
- Конический роликовый: ГОСТ 72xx ↔ 302xx, 73xx ↔ 303xx, 75xx ↔ 322xx, 76xx ↔ 323xx.
- Цилиндрический роликовый: N/NU/NJ/NF/NUP — это кинематика и осевая фиксация, не декор. Без подтверждения конфигурации бортов прямой аналог не подтверждай.

Шаг 6. Морфологическая инверсия: признаки, сидящие в ГОСТ слева/внутри номера, в ISO чаще переходят в суффиксы.
- Уплотнения/щиты: ГОСТ 60 → Z; 80 → 2Z/ZZ; 160 → RS/RS1; 180 → 2RS/2RS1/2RSR/DDU/LLU/EE (только по семейству функции, не как безусловно одинаковые товарные позиции).
- Зазор: ГОСТ 6 → C2; нормальный → CN/C0; 7 → C3; 8 → C4; 9 → C5.
- Точность: ГОСТ 0 → P0/Normal; 6 → P6; 5 → P5; 4 → P4; 2 → P2.

Шаг 7. Проверка значимого суффикса: OPEN, Z, 2Z, RS, 2RS, CN/C0, C2, C3, C4, C5, P6, P5, P4, P2, K, N, NR. Не совпало — прямой аналог не подтверждай.

Шаг 8. Валидация перед выводом: тип / d/D/B/H/T / исполнение / зазор / точность / отсутствие потерь критичных признаков при переводе / отсутствие конфликтов по суффиксам, бортам, уплотнениям. При любом непокрытом пункте → ТРЕБУЕТ_ПРОВЕРКИ или ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ.

КРИТИЧЕСКИЕ ЛОВУШКИ (не смешивай автоматически):
- Символ K/К: в ISO «K» — обычно коническое отверстие; в ГОСТ «К» — может быть другой конструктивной модификацией. Контекст обязателен.
- Брендовые суффиксы одной функции — не равно один товар: SKF 2RS1/2RSH, FAG/Schaeffler 2RSR/2HRS, NSK DDU, NTN LLU, SNR EE, KOYO 2RS. Сводить только на уровне функционального семейства при проверке геометрии и исполнения.
- Масса не выводится по серии — только при точном совпадении бренда и исполнения. Размеры — по серии можно; массу — нет.
- Дюймовые, сборочные, парные, редкие, спец — прямой аналог автоматически не подтверждай; ставь ТРЕБУЕТ_ПРОВЕРКИ.

ПРАВИЛА ВЗАИМОЗАМЕНЯЕМОСТИ:
- Полная: совпали тип, геометрия, серия, исполнение и критичные признаки.
- Односторонняя: более защищённый / более точный / более усиленный вариант иногда может заменить базовый, но не наоборот. Если замена односторонняя — так и пиши: «Допустима замена только в эту сторону. Обратная замена рискованна.»

КОММЕРЧЕСКАЯ ГРАНИЦА:
Если пользователь спрашивает про наличие, цену, поставку, заказ или КП — не выдумывай. Отвечай: «Это требует подтверждения менеджером или актуальной системы учёта». Если техническая часть понятна — сначала дай технический вывод.

ФОРМУЛИРОВКИ:
- Уверенный ответ: «Подтверждённый вариант:», «Прямой аналог:», «Геометрия и исполнение совпадают».
- Осторожный: «Вероятно, речь о:», «По базовому номеру похоже на:», «Без проверки исполнения точный аналог подтверждать нельзя», «Требуется ручная проверка».
- Отказ от выдумки: «Не могу честно подтвердить это без размеров или полной маркировки», «По одному базовому номеру аналог подбирать рискованно», «Это будет предположение, а не технически подтверждённый вывод», «Прямой эквивалент не подтверждён».

ФИНАЛЬНАЯ САМОПРОВЕРКА (если хоть один «нет» — понижай уверенность до ТРЕБУЕТ_ПРОВЕРКИ или ПРЯМОГО_ЭКВИВАЛЕНТА_НЕТ):
1. Дал решение сразу?
2. Отделил подтверждённое от вероятного?
3. Не назвал аналог без проверки геометрии и исполнения?
4. Не придумал массу?
5. Обозначил риски?
6. Указал, что нужно уточнить, если данных мало?
7. Написал по-русски без лишней латиницы в обычном тексте?

Пиши на русском. Никогда не упоминай «каталог», «базу знаний», «RAG», «векторы», «документы из загрузки» — источники контекста скрыты.`;

function jsonOk(data = {}, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...data }), { status, headers: JSON_HEADERS });
}

function jsonErr(message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: JSON_HEADERS });
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  const got = request.headers.get('X-Admin-Token');
  return typeof got === 'string' && got === expected;
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const trimmed = raw.slice(-MAX_HISTORY);
  const out = [];
  for (const m of trimmed) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null;
    if (!role) continue;
    const content = String(m.content ?? '').slice(0, MAX_CONTENT);
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

async function embed(env, texts) {
  const arr = Array.isArray(texts) ? texts : [texts];
  const resp = await env.AI.run(EMBED_MODEL, { text: arr });
  return resp?.data ?? [];
}

function catalogRowToText(r) {
  const parts = [`Подшипник ${r.base_number}`];
  if (r.brand) parts.push(`бренд ${r.brand}`);
  if (r.type) parts.push(`тип ${r.type}`);
  if (r.d_inner && r.d_outer && r.width_mm) parts.push(`размеры d=${r.d_inner} D=${r.d_outer} B=${r.width_mm}`);
  const analogs = ['skf_analog', 'fag_analog', 'nsk_analog', 'ntn_analog', 'zwz_analog']
    .map(k => r[k])
    .filter(Boolean);
  if (analogs.length) parts.push(`аналоги: ${analogs.join(', ')}`);
  if (r.seal) parts.push(`уплотнение ${r.seal}`);
  if (r.clearance) parts.push(`зазор ${r.clearance}`);
  if (r.price_rub) parts.push(`цена ${r.price_rub} руб`);
  if (r.qty) parts.push(`остаток ${r.qty}`);
  return parts.join(', ');
}

async function searchCatalog(env, query, limit = CATALOG_TOPK) {
  const clean = String(query || '').trim().slice(0, 120);
  if (!clean) return [];
  const tokens = clean.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!tokens.length) return [];
  const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '')}"*`).join(' OR ');
  try {
    const { results } = await env.DB
      .prepare(`SELECT c.* FROM catalog_fts f JOIN catalog c ON c.id = f.rowid
                WHERE catalog_fts MATCH ? LIMIT ?`)
      .bind(ftsQuery, limit)
      .all();
    return results || [];
  } catch {
    const { results } = await env.DB
      .prepare(`SELECT * FROM catalog WHERE base_number LIKE ? LIMIT ?`)
      .bind(`%${tokens[0]}%`, limit)
      .all();
    return results || [];
  }
}

async function searchKnowledge(env, query, topK = VECTOR_TOPK) {
  const vecs = await embed(env, query);
  if (!vecs[0]) return [];
  const vec = Array.isArray(vecs[0]) ? vecs[0] : vecs[0].values || vecs[0];
  const res = await env.VECTORIZE.query(vec, { topK, returnMetadata: 'all' });
  const matches = res?.matches || [];
  return matches.map(m => ({
    id: m.id,
    score: m.score,
    title: m.metadata?.title || '',
    content: m.metadata?.content || '',
    source: m.metadata?.source || 'kb',
  }));
}

function buildContext(catalogRows, kbMatches) {
  const parts = [];
  if (catalogRows.length) {
    parts.push('Позиции из каталога:');
    for (const r of catalogRows) parts.push('- ' + catalogRowToText(r));
  }
  if (kbMatches.length) {
    parts.push('\nФрагменты из базы знаний:');
    for (const m of kbMatches) {
      const snippet = String(m.content).slice(0, 600).replace(/\s+/g, ' ').trim();
      parts.push(`- [${m.title}] ${snippet}`);
    }
  }
  return parts.join('\n');
}

function dataUrlToBytes(dataUrl) {
  const m = /^data:[^;]+;base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function describeImage(env, image, userQuery) {
  const bytes = dataUrlToBytes(image?.dataUrl);
  if (!bytes || !bytes.length) return '';
  const prompt = `Ты — эксперт по подшипникам. Опиши изображение максимально подробно: видимая маркировка (буквы, цифры, префиксы, суффиксы), бренд, размеры, состояние, уплотнения, тип. Если текст нечёткий — укажи это. Контекст вопроса: ${String(userQuery || '').slice(0, 240)}`;
  try {
    const resp = await env.AI.run(VISION_MODEL, {
      image: Array.from(bytes),
      prompt,
      max_tokens: 300,
    });
    const text = resp?.description ?? resp?.response ?? '';
    return String(text).trim().slice(0, 1200);
  } catch {
    return '';
  }
}

async function handleChat(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }

  const messages = sanitizeMessages(body?.messages);
  if (!messages?.length) return jsonErr('messages required');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return jsonErr('No user message');

  // Attachments for the current turn, separate from chat messages to keep
  // history compact and avoid noisy RAG queries.
  const attachmentText = String(body?.attachment_text || '').slice(0, MAX_ATTACHMENT_TEXT);
  const rawImages = Array.isArray(body?.images) ? body.images : [];
  const images = rawImages.slice(0, MAX_IMAGES).filter(x => x && typeof x.dataUrl === 'string');

  // RAG uses only the pure user question, not attachment payload.
  const searchQuery = lastUser.content;
  const [catalogRows, kbMatches] = await Promise.all([
    searchCatalog(env, searchQuery).catch(() => []),
    searchKnowledge(env, searchQuery).catch(() => []),
  ]);

  // Vision pass: describe each attached image up-front.
  const imageDescs = [];
  for (const img of images) {
    const desc = await describeImage(env, img, searchQuery);
    if (desc) imageDescs.push(`📷 ${String(img.name || 'image').slice(0, 80)}: ${desc}`);
  }

  const ctx = buildContext(catalogRows, kbMatches);
  const parts = [];
  if (ctx) parts.push('Контекст:\n' + ctx);
  if (attachmentText) parts.push('Прикреплённые документы (фрагменты):\n' + attachmentText);
  if (imageDescs.length) parts.push('Описание прикреплённых изображений:\n' + imageDescs.join('\n'));
  parts.push('Вопрос: ' + searchQuery);

  const aiMessages = [
    { role: 'system', content: AI_SYSTEM },
    ...messages.slice(0, -1),
    { role: 'user', content: parts.join('\n\n') },
  ];

  let stream;
  try {
    stream = await env.AI.run(CHAT_MODEL, {
      messages: aiMessages,
      max_tokens: MAX_TOKENS,
      temperature: 0.2,
      stream: true,
    });
  } catch (e) {
    return jsonErr(`AI error: ${e?.message || e}`, 502);
  }

  const headers = {
    ...SSE_HEADERS,
    'X-Sources-Catalog': String(catalogRows.length),
    'X-Sources-Kb': String(kbMatches.length),
    'X-Images-Described': String(imageDescs.length),
  };
  return new Response(stream, { headers });
}

async function handleSearch(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  if (!q.trim()) return jsonErr('q required');
  const [catalog, kb] = await Promise.all([
    searchCatalog(env, q).catch(() => []),
    searchKnowledge(env, q).catch(() => []),
  ]);
  return jsonOk({ catalog, kb });
}

function chunkText(text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + size, clean.length);
    let slice = clean.slice(i, end);
    if (end < clean.length) {
      const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
      if (lastPeriod > size * 0.6) slice = slice.slice(0, lastPeriod + 1);
    }
    chunks.push(slice.trim());
    i += slice.length - overlap;
    if (i <= 0) break;
  }
  return chunks.filter(Boolean);
}

const STRIDE = CHUNK_CHARS - CHUNK_OVERLAP;
function totalChunksCount(len) {
  if (!len) return 0;
  if (len <= CHUNK_CHARS) return 1;
  return Math.ceil((len - CHUNK_OVERLAP) / STRIDE);
}
function sliceChunkAt(text, idx) {
  const start = idx * STRIDE;
  if (start >= text.length) return '';
  const end = Math.min(start + CHUNK_CHARS, text.length);
  return text.slice(start, end).trim();
}

async function handleIngest(request, env) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);

  let body;
  try { body = await request.json(); } catch { return jsonErr('Invalid JSON'); }

  const title = String(body?.title || '').trim().slice(0, 200);
  const text = String(body?.text || '').trim().slice(0, MAX_DOC_CHARS);
  const category = String(body?.category || 'docs').slice(0, 50);
  const source = String(body?.source || 'manual').slice(0, 100);
  if (!title || !text) return jsonErr('title and text required');

  const chunks = chunkText(text);
  if (!chunks.length) return jsonErr('no usable text');

  const ins = await env.DB
    .prepare('INSERT INTO knowledge_base (category, title, content, keywords) VALUES (?, ?, ?, ?)')
    .bind(category, title, text, source)
    .run();
  const kbId = ins?.meta?.last_row_id;
  if (!kbId) return jsonErr('Failed to persist document to D1', 500);

  const embeddings = await embed(env, chunks);
  const vectors = chunks.map((c, i) => {
    const rawVec = embeddings[i];
    const values = Array.isArray(rawVec) ? rawVec : rawVec?.values || [];
    return {
      id: `kb-${kbId}-${i}`,
      values,
      metadata: { title, content: c, source, category, kb_id: kbId, chunk: i },
    };
  }).filter(v => v.values.length === EMBED_DIMS);

  if (vectors.length) {
    await env.VECTORIZE.upsert(vectors);
  }

  return jsonOk({ chunks: vectors.length, title, kb_id: kbId });
}

const REINDEX_CHUNKS_PER_CALL = 12;

async function handleReindex(request, env) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);
  const url = new URL(request.url);
  const afterId = Math.max(0, parseInt(url.searchParams.get('after_id') || '0', 10));
  const chunkFrom = Math.max(0, parseInt(url.searchParams.get('chunk_from') || '0', 10));

  const row = chunkFrom > 0
    ? await env.DB.prepare('SELECT id, category, title, content, keywords, LENGTH(content) AS len FROM knowledge_base WHERE id = ?').bind(afterId).first()
    : await env.DB.prepare('SELECT id, category, title, content, keywords, LENGTH(content) AS len FROM knowledge_base WHERE id > ? ORDER BY id LIMIT 1').bind(afterId).first();

  if (!row) {
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge_base').first();
    return jsonOk({ indexed: 0, done: true, total: total?.n ?? 0 });
  }

  const totalChunks = totalChunksCount(row.len);
  const endIdx = Math.min(chunkFrom + REINDEX_CHUNKS_PER_CALL, totalChunks);
  const slice = [];
  for (let i = chunkFrom; i < endIdx; i++) {
    const c = sliceChunkAt(row.content, i);
    if (c) slice.push({ idx: i, text: c });
  }
  if (!slice.length) {
    return jsonOk({ indexed: 0, kb_id: row.id, chunks_total: totalChunks, done: false, next_after_id: row.id, next_chunk_from: 0, row_done: true });
  }

  const embeddings = await embed(env, slice.map(s => s.text));
  const vectors = slice.map((s, k) => {
    const raw = embeddings[k];
    const values = Array.isArray(raw) ? raw : raw?.values || [];
    return {
      id: `kb-${row.id}-${s.idx}`,
      values,
      metadata: {
        title: row.title,
        content: s.text,
        source: row.keywords || 'kb',
        category: row.category,
        kb_id: row.id,
      },
    };
  }).filter(v => v.values.length === EMBED_DIMS);

  if (vectors.length) await env.VECTORIZE.upsert(vectors);

  const nextChunkFrom = endIdx;
  const rowDone = nextChunkFrom >= totalChunks;
  return jsonOk({
    indexed: vectors.length,
    kb_id: row.id,
    title: row.title,
    chunks_total: totalChunks,
    done: false,
    next_after_id: row.id,
    next_chunk_from: rowDone ? 0 : nextChunkFrom,
    row_done: rowDone,
  });
}

async function handleStats(env) {
  try {
    const kb = await env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge_base').first();
    const catalog = await env.DB.prepare('SELECT COUNT(*) AS n FROM catalog').first();
    let vec = null;
    try {
      vec = await env.VECTORIZE.describe();
    } catch {}
    return jsonOk({ knowledge_base: kb?.n ?? 0, catalog: catalog?.n ?? 0, vectorize: vec });
  } catch (e) {
    return jsonErr(`Stats error: ${e.message}`, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: FRAME_HEADERS });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') return handleChat(request, env);
    if (url.pathname === '/api/search' && request.method === 'GET') return handleSearch(request, env);
    if (url.pathname === '/api/ingest' && request.method === 'POST') return handleIngest(request, env);
    if (url.pathname === '/api/reindex' && request.method === 'POST') return handleReindex(request, env);
    if (url.pathname === '/api/stats' && request.method === 'GET') return handleStats(env);
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonOk({ model: CHAT_MODEL, embed: EMBED_MODEL });
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonErr(`Unknown route ${request.method} ${url.pathname}`, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
