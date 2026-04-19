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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+?)`/g, '<code>$1</code>');
  }

  // Minimal markdown renderer for chat responses: pipe tables, bullets,
  // inline emphasis, preserved line breaks. No external library.
  function renderMarkdown(md) {
    if (!md) return '';
    const lines = md.replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Table block: at least header + separator
      if (line.trim().startsWith('|') && i + 1 < lines.length &&
          /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
        const header = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const row = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
          rows.push(row);
          i++;
        }
        let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
        for (const h of header) html += `<th>${renderInline(h)}</th>`;
        html += '</tr></thead><tbody>';
        for (const row of rows) {
          html += '<tr>';
          for (let k = 0; k < header.length; k++) html += `<td>${renderInline(row[k] ?? '')}</td>`;
          html += '</tr>';
        }
        html += '</tbody></table></div>';
        out.push(html);
        continue;
      }

      // Bullet list
      if (/^\s*[-•]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-•]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-•]\s+/, ''));
          i++;
        }
        out.push('<ul class="md-list">' + items.map(x => `<li>${renderInline(x)}</li>`).join('') + '</ul>');
        continue;
      }

      // Blank line / paragraph break
      if (!line.trim()) { out.push(''); i++; continue; }

      // Default: paragraph line
      out.push(`<p class="md-p">${renderInline(line)}</p>`);
      i++;
    }
    return out.join('');
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
          // Server enforces 12k total across all attachments — keep a bit
          // more locally so several docs can still fit, but cap each to 6k.
          entry.text = (t || '').slice(0, 6000);
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

    // Keep chat history clean: messages carry only the pure question/answer
    // text so server-side RAG searches on a focused query. Attachments go
    // alongside as a separate payload for the current turn only.
    const docAttachments = pending.filter(p => p.kind !== 'image' && p.text);
    const imgAttachments = pending.filter(p => p.kind === 'image' && p.dataUrl);
    const otherAttachments = pending.filter(p => p.kind !== 'image' && !p.text);

    const attachmentChunks = docAttachments.map(p => `📎 ${p.name}:\n${p.text}`);
    for (const p of otherAttachments) attachmentChunks.push(`📎 ${p.name} (${fmtSize(p.size)}) — текст не распознан`);
    const attachmentText = attachmentChunks.join('\n\n').slice(0, 12000);

    const displayAtts = pending.map(p => ({ name: p.name, size: p.size, kind: p.kind, dataUrl: p.dataUrl }));
    pending = [];
    renderPending();

    const userContentForHistory = prompt || (displayAtts.length ? '(см. прикреплённые материалы)' : '');
    messages.push({ role: 'user', content: userContentForHistory });
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
        body: JSON.stringify({
          messages,
          attachment_text: attachmentText || undefined,
          images: imgAttachments.map(p => ({ name: p.name, dataUrl: p.dataUrl })),
        }),
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
      if (botText) {
        botEl.innerHTML = renderMarkdown(botText);
      } else {
        botEl.textContent = '(пустой ответ)';
      }
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

  async function reindexCall(afterId, chunkFrom, token) {
    const r = await fetch(`/api/reindex?after_id=${afterId}&chunk_from=${chunkFrom}`, {
      method: 'POST',
      headers: { 'X-Admin-Token': token },
    });
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const txt = await r.text().catch(() => '');
      const snippet = txt.replace(/<[^>]+>/g, ' ').trim().slice(0, 160);
      const err = new Error(`HTTP ${r.status} ${r.statusText || ''} ${snippet}`.trim());
      err.status = r.status;
      throw err;
    }
    const j = await r.json();
    if (!j.ok) {
      const err = new Error(j.error || `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return j;
  }

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
    const RETRY_DELAYS = [1500, 3000, 6000];

    try {
      outer: while (true) {
        setStatus(`Переиндексирую: записей обработано ${rowsDone}, фрагментов ${totalChunks}…`, 'info');
        let j;
        let lastErr;
        for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
          try {
            j = await reindexCall(afterId, chunkFrom, token);
            break;
          } catch (e) {
            lastErr = e;
            const transient = !e.status || e.status >= 500 || e.status === 429;
            if (!transient || attempt === RETRY_DELAYS.length) break;
            const delay = RETRY_DELAYS[attempt];
            setStatus(`Временная ошибка (${e.message?.slice(0, 120)}), повтор через ${delay / 1000}с…`, 'info');
            await new Promise(r => setTimeout(r, delay));
          }
        }
        if (!j) {
          // Skip this chunk window to make forward progress instead of
          // getting stuck on one bad record.
          setStatus(`Пропускаю проблемный фрагмент (after_id=${afterId}, chunk_from=${chunkFrom}): ${lastErr?.message || 'неизвестная ошибка'}`, 'error');
          await new Promise(r => setTimeout(r, 1200));
          if (chunkFrom > 0) {
            // skip rest of current row
            chunkFrom = 0;
          } else {
            // couldn't even start this row, advance past it
            afterId += 1;
          }
          continue outer;
        }
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
