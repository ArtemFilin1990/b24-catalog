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
      const vec = j.vectorize?.vectorCount ?? j.vectorize?.vectorsCount ?? '?';
      $('#stats').textContent = `каталог ${j.catalog} · KB ${j.knowledge_base} · векторов ${vec}`;
    } catch { /* ignore */ }
  }
  loadStats();

  // ---------- File text extraction ----------
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

  async function extractText(file) {
    const name = (file.name || '').toLowerCase();
    const type = file.type || '';
    if (name.endsWith('.pdf') || type === 'application/pdf') return extractPdf(file);
    if (name.endsWith('.docx') || type.includes('officedocument.wordprocessingml')) return extractDocx(file);
    try { return await file.text(); } catch { return ''; }
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function isImage(file) {
    return file && (file.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || ''));
  }

  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  // ---------- Chat ----------
  const chatEl = $('#chat');
  const formEl = $('#form');
  const inputEl = $('#input');
  const sendEl = $('#send');
  const clearEl = $('#clear-btn');
  const attachBtn = $('#attach-btn');
  const attachInput = $('#attach-input');
  const attachedListEl = $('#attached-list');

  const EXAMPLES = [
    'аналог 6205 2RS C3',
    'что это за подшипник 180205',
    'подбери аналог для NU205',
    'расшифруй 7606',
  ];

  // Chat messages for the model: [{ role, content }]
  let messages = [];
  // Client-side metadata per message index (attachments for display)
  let attachmentsByMsg = {};
  // Currently pending attachments before send
  let pending = [];
  let streaming = false;

  function renderEmptyState() {
    chatEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    wrap.innerHTML = '<h2>Чем помочь?</h2><p>Подберу подшипник, найду аналог, расшифрую маркировку. Можно прислать фото таблички или PDF со спецификацией.</p><div class="examples"></div>';
    const ex = wrap.querySelector('.examples');
    EXAMPLES.forEach(q => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'example-chip';
      b.textContent = q;
      b.addEventListener('click', () => { inputEl.value = q; autoresize(); inputEl.focus(); });
      ex.appendChild(b);
    });
    chatEl.appendChild(wrap);
  }

  function clearEmpty() {
    const e = chatEl.querySelector('.empty-state');
    if (e) e.remove();
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
    attachBtn.disabled = v;
    inputEl.disabled = v;
  }

  function renderAttachmentChips(container, atts) {
    if (!atts?.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'attachments';
    for (const a of atts) {
      if (a.kind === 'image' && a.dataUrl) {
        const img = document.createElement('img');
        img.className = 'attach-img';
        img.src = a.dataUrl;
        img.alt = a.name;
        wrap.appendChild(img);
        continue;
      }
      const chip = document.createElement('span');
      chip.className = 'attach-chip';
      chip.textContent = `📎 ${a.name} · ${fmtSize(a.size)}`;
      wrap.appendChild(chip);
    }
    container.appendChild(wrap);
  }

  function appendUserMsg(text, atts) {
    clearEmpty();
    const el = document.createElement('div');
    el.className = 'msg user';
    renderAttachmentChips(el, atts);
    if (text) {
      const t = document.createElement('div');
      t.textContent = text;
      el.appendChild(t);
    }
    chatEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function appendBotMsg(content = '', { error = false } = {}) {
    clearEmpty();
    const el = document.createElement('div');
    el.className = `msg bot${error ? ' error' : ''}`;
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

  // ---------- Pending attachments UI ----------
  function renderPending() {
    attachedListEl.innerHTML = '';
    pending.forEach((p, idx) => {
      const chip = document.createElement('div');
      chip.className = 'attached-item';
      if (p.kind === 'image' && p.dataUrl) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = p.dataUrl;
        chip.appendChild(img);
      } else {
        const dot = document.createElement('span');
        dot.textContent = '📎';
        chip.appendChild(dot);
      }
      const label = document.createElement('span');
      const extra = p.extractedChars ? ` · ${p.extractedChars.toLocaleString('ru')} симв.` : '';
      label.textContent = `${p.name} · ${fmtSize(p.size)}${extra}`;
      chip.appendChild(label);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'rm';
      rm.textContent = '✕';
      rm.addEventListener('click', () => {
        pending.splice(idx, 1);
        renderPending();
      });
      chip.appendChild(rm);
      attachedListEl.appendChild(chip);
    });
  }

  attachBtn.addEventListener('click', () => attachInput.click());

  attachInput.addEventListener('change', async () => {
    const files = Array.from(attachInput.files || []);
    for (const f of files) {
      const entry = {
        name: f.name,
        size: f.size,
        kind: isImage(f) ? 'image' : 'file',
        text: '',
        extractedChars: 0,
        dataUrl: null,
      };
      if (entry.kind === 'image') {
        try { entry.dataUrl = await readAsDataUrl(f); } catch { /* ignore */ }
      } else {
        try {
          const t = await extractText(f);
          entry.text = (t || '').slice(0, 20000);
          entry.extractedChars = entry.text.length;
        } catch { /* ignore */ }
      }
      pending.push(entry);
    }
    attachInput.value = '';
    renderPending();
  });

  // ---------- Send ----------
  async function sendMessage(text) {
    const prompt = (text || '').trim();
    if (!prompt && pending.length === 0) return;
    if (streaming) return;

    // Build user content with attached text
    let merged = prompt;
    const attParts = [];
    for (const p of pending) {
      if (p.kind === 'image') attParts.push(`[Изображение: ${p.name}]`);
      else if (p.text) attParts.push(`\n\n📎 ${p.name}:\n${p.text}`);
      else attParts.push(`[Файл: ${p.name}, ${fmtSize(p.size)}]`);
    }
    if (attParts.length) merged = (prompt ? prompt + '\n\n' : '') + attParts.join('\n');

    const displayAtts = pending.map(p => ({ name: p.name, size: p.size, kind: p.kind, dataUrl: p.dataUrl }));
    pending = [];
    renderPending();

    messages.push({ role: 'user', content: merged || '(без текста)' });
    appendUserMsg(prompt, displayAtts);

    inputEl.value = '';
    autoresize();

    const botEl = appendBotMsg('');
    const cursor = appendCursor(botEl);
    let botText = '';
    setStreaming(true);

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

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
      messages.push({ role: 'assistant', content: botText });
    } catch (e) {
      cursor.remove();
      botEl.remove();
      appendBotMsg(`Ошибка: ${e.message || e}`, { error: true });
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
    attachmentsByMsg = {};
    pending = [];
    renderPending();
    renderEmptyState();
    inputEl.focus();
  });

  renderEmptyState();
  inputEl.focus();

  // ---------- KB upload ----------
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

  fileEl.addEventListener('change', async () => {
    const f = fileEl.files?.[0];
    if (!f) return;
    if (!titleEl.value.trim()) titleEl.value = f.name.replace(/\.[^.]+$/, '');
    setStatus(`Извлекаю текст из ${f.name}…`, 'info');
    try {
      const text = await extractText(f);
      textEl.value = (text || '').slice(0, 300000);
      if (!textEl.value) {
        setStatus(`Файл ${f.name} не содержит распознанного текста. Вставьте вручную или выберите другой.`, 'error');
      } else {
        setStatus(`Извлечено ${text.length.toLocaleString('ru')} символов. Нажмите «Загрузить в базу».`, 'success');
      }
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
    setStatus('Индексирую…', 'info');
    uploadBtn.disabled = true;
    try {
      const r = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ title, text, category, source: fileEl.files?.[0]?.name || 'manual' }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setStatus(`Готово. Добавлено: ${j.chunks} фрагментов (ID ${j.kb_id}).`, 'success');
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
    if (!confirm('Перестроить индекс по всем записям knowledge_base? Может занять несколько минут.')) return;
    try { localStorage.setItem('ai-kb-admin', token); } catch {}
    reindexBtn.disabled = true;
    let afterId = 0;
    let chunkFrom = 0;
    let totalChunks = 0;
    let rowsDone = 0;
    try {
      while (true) {
        setStatus(`Переиндексирую: обработано ${rowsDone} записей, ${totalChunks} фрагментов…`, 'info');
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
      setStatus(`Готово. Проиндексировано ${totalChunks} фрагментов.`, 'success');
      loadStats();
    } catch (e) {
      setStatus(`Прервано (after_id=${afterId}, chunk_from=${chunkFrom}): ${e.message || e}`, 'error');
    } finally {
      reindexBtn.disabled = false;
    }
  });
})();
