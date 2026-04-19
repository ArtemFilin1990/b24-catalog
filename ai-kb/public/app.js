(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---------- Tabs ----------
  const tabs = document.querySelectorAll('.tab');
  const views = { chat: $('#view-chat'), upload: $('#view-upload') };
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.toggle('active', x === t));
    Object.entries(views).forEach(([k, v]) => v.classList.toggle('active', k === t.dataset.tab));
  }));

  // ---------- Stats ----------
  async function loadStats() {
    try {
      const r = await fetch('/api/stats');
      const j = await r.json();
      if (!j.ok) return;
      const vec = j.vectorize?.vectorsCount ?? j.vectorize?.vectors_count ?? '?';
      $('#stats').textContent = `каталог: ${j.catalog} · KB: ${j.knowledge_base} · векторов: ${vec}`;
    } catch { /* ignore */ }
  }
  loadStats();

  // ---------- Chat ----------
  const chatEl = $('#chat');
  const formEl = $('#form');
  const inputEl = $('#input');
  const sendEl = $('#send');
  const clearEl = $('#clear-btn');

  const EXAMPLES = [
    'Подбери подшипник 6205 2RS C3',
    'Аналог SKF 6305 от NSK',
    'Чем 2RS отличается от ZZ?',
    'Какие размеры у 22210 EK?',
  ];

  let messages = [];
  let streaming = false;

  function renderEmptyState() {
    chatEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    wrap.innerHTML = '<div>Привет! Я — ИИ-помощник по подшипникам ТД «Эверест». Знаю каталог и базу знаний.</div><div class="examples"></div>';
    const examples = wrap.querySelector('.examples');
    for (const ex of EXAMPLES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'example-chip';
      chip.textContent = ex;
      chip.addEventListener('click', () => { inputEl.value = ex; autoresize(); inputEl.focus(); });
      examples.appendChild(chip);
    }
    chatEl.appendChild(wrap);
  }

  function clearEmpty() { const e = chatEl.querySelector('.empty-state'); if (e) e.remove(); }

  function appendMsg(role, content, { error = false } = {}) {
    clearEmpty();
    const el = document.createElement('div');
    el.className = `msg ${role}${error ? ' error' : ''}`;
    el.textContent = content;
    chatEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function appendCursor(el) {
    const c = document.createElement('span');
    c.className = 'cursor';
    el.appendChild(c);
    return c;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  }

  function autoresize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  }

  function setStreaming(v) {
    streaming = v;
    sendEl.disabled = v;
    inputEl.disabled = v;
  }

  async function sendMessage(text) {
    const q = text.trim();
    if (!q || streaming) return;
    messages.push({ role: 'user', content: q });
    appendMsg('user', q);
    inputEl.value = '';
    autoresize();

    const botEl = appendMsg('bot', '');
    const cursor = appendCursor(botEl);
    let botText = '';
    let sources = { catalog: 0, kb: 0 };

    setStreaming(true);
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      sources.catalog = Number(resp.headers.get('X-Sources-Catalog') || 0);
      sources.kb = Number(resp.headers.get('X-Sources-Kb') || 0);

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => `HTTP ${resp.status}`);
        throw new Error(errTxt.slice(0, 200));
      }
      if (!resp.body) throw new Error('Пустой ответ');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = j.response ?? j.delta ?? '';
            if (delta) {
              botText += delta;
              cursor.remove();
              botEl.textContent = botText;
              botEl.appendChild(cursor);
              scrollToBottom();
            }
          } catch { /* skip malformed chunk */ }
        }
      }

      cursor.remove();
      botEl.textContent = botText || '(пустой ответ)';
      if (sources.catalog || sources.kb) {
        const src = document.createElement('div');
        src.className = 'sources';
        const parts = [];
        if (sources.catalog) parts.push(`каталог: ${sources.catalog}`);
        if (sources.kb) parts.push(`база знаний: ${sources.kb}`);
        src.textContent = 'Источники — ' + parts.join(' · ');
        botEl.appendChild(src);
      }
      messages.push({ role: 'assistant', content: botText });
    } catch (e) {
      cursor.remove();
      botEl.remove();
      appendMsg('bot', `Ошибка: ${e.message || e}`, { error: true });
      messages.pop();
    } finally {
      setStreaming(false);
      inputEl.focus();
    }
  }

  formEl.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(inputEl.value); });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value); }
  });
  inputEl.addEventListener('input', autoresize);
  clearEl.addEventListener('click', () => {
    if (streaming) return;
    messages = [];
    renderEmptyState();
    inputEl.focus();
  });

  renderEmptyState();
  inputEl.focus();

  // ---------- Upload / KB ----------
  const titleEl = $('#doc-title');
  const textEl = $('#doc-text');
  const fileEl = $('#doc-file');
  const catEl = $('#doc-category');
  const tokenEl = $('#admin-token');
  const statusEl = $('#upload-status');
  const uploadBtn = $('#upload-btn');
  const reindexBtn = $('#reindex-btn');

  try { tokenEl.value = localStorage.getItem('ai-kb-admin') || ''; } catch {}

  function setStatus(msg, kind = 'info') {
    statusEl.hidden = !msg;
    statusEl.className = 'upload-status ' + kind;
    statusEl.textContent = msg || '';
  }

  async function extractPdf(file) {
    if (!window.pdfjsLib) throw new Error('pdf.js не загружен');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(x => x.str).join(' '));
    }
    return pages.join('\n\n');
  }

  async function extractDocx(file) {
    if (!window.mammoth) throw new Error('mammoth не загружен');
    const buf = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buf });
    return res.value || '';
  }

  async function extractFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return await extractPdf(file);
    if (name.endsWith('.docx')) return await extractDocx(file);
    if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
      return await file.text();
    }
    throw new Error('Неподдерживаемый формат: ' + file.name);
  }

  fileEl.addEventListener('change', async () => {
    const f = fileEl.files?.[0];
    if (!f) return;
    if (!titleEl.value.trim()) titleEl.value = f.name.replace(/\.[^.]+$/, '');
    setStatus(`Извлекаю текст из ${f.name}…`, 'info');
    try {
      const text = await extractFile(f);
      textEl.value = text.slice(0, 200000);
      setStatus(`Извлечено ${text.length.toLocaleString('ru')} символов. Нажмите «Загрузить в базу».`, 'success');
    } catch (e) {
      setStatus('Ошибка: ' + (e.message || e), 'error');
    }
  });

  uploadBtn.addEventListener('click', async () => {
    const title = titleEl.value.trim();
    const text = textEl.value.trim();
    const token = tokenEl.value.trim();
    const category = catEl.value;
    if (!title) return setStatus('Укажите заголовок', 'error');
    if (!text) return setStatus('Нет текста для загрузки', 'error');
    if (!token) return setStatus('Введите X-Admin-Token', 'error');

    try { localStorage.setItem('ai-kb-admin', token); } catch {}
    setStatus('Индексирую в Vectorize…', 'info');
    uploadBtn.disabled = true;
    try {
      const r = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ title, text, category, source: fileEl.files?.[0]?.name || 'manual' }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setStatus(`Готово. Проиндексировано ${j.chunks} чанков, kb_id=${j.kb_id}.`, 'success');
      titleEl.value = '';
      textEl.value = '';
      fileEl.value = '';
      loadStats();
    } catch (e) {
      setStatus('Ошибка загрузки: ' + (e.message || e), 'error');
    } finally {
      uploadBtn.disabled = false;
    }
  });

  reindexBtn.addEventListener('click', async () => {
    const token = tokenEl.value.trim();
    if (!token) return setStatus('Введите X-Admin-Token', 'error');
    if (!confirm('Перестроить индекс по всем записям knowledge_base? Это может занять несколько минут.')) return;
    try { localStorage.setItem('ai-kb-admin', token); } catch {}
    reindexBtn.disabled = true;
    let afterId = 0;
    let chunkFrom = 0;
    let totalChunks = 0;
    let rowsDone = 0;
    try {
      while (true) {
        setStatus(`Переиндексирую: записей обработано ${rowsDone}, чанков ${totalChunks}…`, 'info');
        const r = await fetch(`/api/reindex?after_id=${afterId}&chunk_from=${chunkFrom}`, {
          method: 'POST',
          headers: { 'X-Admin-Token': token },
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        totalChunks += j.indexed || 0;
        if (j.done) break;
        if (j.row_done) rowsDone++;
        afterId = j.next_after_id;
        chunkFrom = j.next_chunk_from;
      }
      setStatus(`Готово. Проиндексировано ${totalChunks} чанков.`, 'success');
      loadStats();
    } catch (e) {
      setStatus(`Прервано (after_id=${afterId}, chunk_from=${chunkFrom}): ${e.message || e}`, 'error');
    } finally {
      reindexBtn.disabled = false;
    }
  });
})();
