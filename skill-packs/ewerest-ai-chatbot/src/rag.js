// src/rag.js — эмбеддинги, Vectorize поиск, R2 загрузка документов, ingest

const EMBED_MODEL = "@cf/baai/bge-m3";
const CHUNK_SIZE = 500; // слов на чанк
const CHUNK_OVERLAP = 50;

/**
 * Получение контекста для /chat: query по KB и catalog индексам.
 */
export async function retrieveContext(env, { query, kbTopK, catalogTopK, bearingHint }) {
  const sources = [];
  const blocks = [];

  // Embedding запроса
  const embed = await embedText(env, query);

  // KB index
  if (env.KB_INDEX && kbTopK > 0) {
    const kbMatches = await env.KB_INDEX.query(embed, { topK: kbTopK, returnMetadata: "all" });
    for (const m of kbMatches.matches || []) {
      const text = await fetchChunkText(env, m.metadata);
      if (text) {
        blocks.push(`[KB:${m.metadata?.doc_id || m.id}] ${text}`);
        sources.push({
          type: "kb",
          doc_id: m.metadata?.doc_id,
          chunk_id: m.metadata?.chunk_id,
          title: m.metadata?.title,
          score: m.score,
        });
      }
    }
  }

  // Catalog index (опционально)
  if (env.CATALOG_INDEX && catalogTopK > 0) {
    const catMatches = await env.CATALOG_INDEX.query(embed, { topK: catalogTopK, returnMetadata: "all" });
    for (const m of catMatches.matches || []) {
      const md = m.metadata || {};
      const line = `[CAT] ${md.part_number || ""} | ${md.brand || ""} | d=${md.d || ""} D=${md.D || ""} H=${md.H || ""} | ${md.name || ""}`;
      blocks.push(line);
      sources.push({
        type: "catalog",
        part_number: md.part_number,
        brand: md.brand,
        score: m.score,
      });
    }
  }

  return {
    text: blocks.join("\n\n"),
    sources,
  };
}

/**
 * Загружает полный текст чанка из R2 (если хранили чанки отдельно)
 * или полный документ и вырезает нужный участок.
 */
async function fetchChunkText(env, metadata) {
  if (!metadata || !env.R2) return null;

  // Вариант 1: в metadata уже есть text (маленькие чанки)
  if (metadata.text) return metadata.text;

  // Вариант 2: чанк как отдельный объект в R2
  if (metadata.r2_key) {
    const obj = await env.R2.get(metadata.r2_key);
    if (obj) return await obj.text();
  }

  // Вариант 3: достаём полный документ и берём окно
  if (metadata.doc_id && metadata.chunk_start !== undefined) {
    const obj = await env.R2.get(`docs/${metadata.doc_id}.txt`);
    if (!obj) return null;
    const full = await obj.text();
    return full.slice(metadata.chunk_start, metadata.chunk_end);
  }

  return null;
}

/**
 * Вызов embedding модели.
 */
export async function embedText(env, text) {
  const r = await env.AI.run(EMBED_MODEL, { text: [text] });
  // Ответ: { shape: [1, dim], data: [[...]] } или { data: [{ embedding: [...] }] }
  if (Array.isArray(r.data) && Array.isArray(r.data[0])) return r.data[0];
  if (Array.isArray(r.data) && r.data[0]?.embedding) return r.data[0].embedding;
  throw new Error("unexpected_embedding_response");
}

/**
 * POST /upload — загрузка файла в R2.
 * multipart/form-data: file, title?, category?
 */
export async function handleUpload(request, env) {
  const form = await request.formData();
  const file = form.get("file");
  const title = form.get("title") || (file?.name ?? "untitled");
  const category = form.get("category") || "other";

  if (!file || typeof file === "string") {
    throw httpError("no_file", 400);
  }

  const docId = crypto.randomUUID();
  const key = `docs/${docId}.bin`;

  await env.R2.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { title, category, filename: file.name },
  });

  // Регистрируем в D1
  await env.DB.prepare(
    `INSERT INTO documents (doc_id, title, category, r2_key, filename, size, uploaded_at, indexed)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)`
  )
    .bind(docId, title, category, key, file.name, file.size, Date.now())
    .run();

  return { doc_id: docId, key, title, size: file.size };
}

/**
 * POST /ingest?doc_id=...
 * Читает документ из R2, парсит в текст, чанкует, эмбеддит, апсертит в Vectorize.
 * Ожидает уже-текстовый файл (TXT/MD) или пре-парсенный в R2 ключе `docs/<id>.txt`.
 * PDF/DOCX парсить в браузере на стороне админки (ai-kb уже так делает).
 */
export async function handleIngest(request, env) {
  const url = new URL(request.url);
  const docId = url.searchParams.get("doc_id");
  if (!docId) throw httpError("doc_id_required", 400);

  // Читаем текстовую версию (админка кладёт `.txt` рядом)
  const textKey = `docs/${docId}.txt`;
  const obj = await env.R2.get(textKey);
  if (!obj) throw httpError(`text_not_found: ${textKey}`, 404);

  const text = await obj.text();
  const doc = await env.DB.prepare(
    `SELECT doc_id, title, category FROM documents WHERE doc_id = ?1`
  )
    .bind(docId)
    .first();

  const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);

  // Эмбеддинг батчами
  const vectors = [];
  let i = 0;
  for (const chunk of chunks) {
    const vec = await embedText(env, chunk.text);
    vectors.push({
      id: `${docId}-${i}`,
      values: vec,
      metadata: {
        doc_id: docId,
        chunk_id: i,
        chunk_start: chunk.start,
        chunk_end: chunk.end,
        title: doc?.title || "",
        category: doc?.category || "other",
        text: chunk.text.slice(0, 500),
      },
    });
    i++;
  }

  // Upsert в Vectorize (батчами по 100)
  for (let j = 0; j < vectors.length; j += 100) {
    await env.KB_INDEX.upsert(vectors.slice(j, j + 100));
  }

  await env.DB.prepare(
    `UPDATE documents SET indexed = 1, chunks = ?2, indexed_at = ?3 WHERE doc_id = ?1`
  )
    .bind(docId, vectors.length, Date.now())
    .run();

  return { doc_id: docId, chunks: vectors.length, status: "indexed" };
}

/**
 * Чанкинг текста с перекрытием по словам.
 */
function chunkText(text, size, overlap) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let pos = 0;
  let charPos = 0;

  while (pos < words.length) {
    const slice = words.slice(pos, pos + size);
    const chunkText = slice.join(" ");
    chunks.push({
      text: chunkText,
      start: charPos,
      end: charPos + chunkText.length,
    });
    charPos += chunkText.length + 1;
    pos += size - overlap;
  }
  return chunks;
}

function httpError(msg, status) {
  const e = new Error(msg);
  e.status = status;
  e.code = msg;
  return e;
}
