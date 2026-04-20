(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---------- Client identity (per-browser) ----------
  // Stable UUID used to own chat_sessions rows on the server so a tab can
  // list + resume only its own history. Stored in localStorage so the same
  // browser comes back to the same sessions after reload.
  const CLIENT_KEY = 'ai-kb-client-id';
  function ensureClientId() {
    try {
      let id = localStorage.getItem(CLIENT_KEY);
      if (!id) {
        id = (crypto?.randomUUID && crypto.randomUUID()) ||
             (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
        localStorage.setItem(CLIENT_KEY, id);
      }
      return id;
    } catch {
      return 'anon-' + Math.random().toString(36).slice(2);
    }
  }
  const CLIENT_ID = ensureClientId();
  function newSessionId() {
    return (crypto?.randomUUID && crypto.randomUUID()) ||
      ('s-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  }

  // ---------- View routing ----------
  const views = { chat: $('#view-chat'), upload: $('#view-upload') };
  const headerTitle = $('#header-title');
  const headerSub = $('#header-sub');
  const backBtn = $('#back-btn');
  const shell = document.querySelector('.shell');
  const sidebar = $('#sidebar');
  const sidebarToggle = $('#sidebar-toggle');

  function showView(name) {
    Object.entries(views).forEach(([k, v]) => v.classList.toggle('active', k === name));
    if (name === 'upload') {
      headerTitle.textContent = 'База знаний';
      headerSub.textContent = 'Управление контентом';
      backBtn.hidden = false;
    } else {
      headerTitle.textContent = 'Бот Эверест';
      headerSub.textContent = 'В сети';
      backBtn.hidden = true;
    }
  }
  backBtn.addEventListener('click', () => showView('chat'));
  $('#kb-back').addEventListener('click', () => showView('chat'));

  // ---------- Sidebar toggle (mobile) ----------
  function toggleSidebar(open) {
    if (!sidebar) return;
    const next = typeof open === 'boolean' ? open : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', next);
    shell?.classList.toggle('sidebar-open', next);
  }
  sidebarToggle?.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });
  document.addEventListener('click', (e) => {
    if (!sidebar || !sidebar.classList.contains('open')) return;
    if (sidebar.contains(e.target) || sidebarToggle?.contains(e.target)) return;
    toggleSidebar(false);
  });

  $('#settings-btn')?.addEventListener('click', () => {
    toggleSidebar(false);
    showView('upload');
  });

  // ---------- Menu sheet ----------
  const menuBtn = $('#menu-btn');
  const sheet = $('#menu-sheet');
  const sheetOverlay = $('#sheet-overlay');

  function closeMenu() {
    sheet.classList.remove('open');
    sheetOverlay.classList.remove('open');
  }
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sheet.classList.toggle('open');
    sheetOverlay.classList.toggle('open');
  });
  sheetOverlay.addEventListener('click', closeMenu);
  sheet.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.action;
      closeMenu();
      if (act === 'kb') showView('upload');
      else if (act === 'clear') clearChat();
    });
  });

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

  async function extractXlsx(file) {
    if (!window.XLSX) throw new Error('SheetJS не загружен');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const parts = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim()) parts.push(`# ${name}\n${csv}`);
    }
    return parts.join('\n\n');
  }

  function looksBinary(s) {
    if (!s) return false;
    const sample = s.slice(0, 4000);
    // Replacement chars + control chars (excl. \n\r\t) ratio.
    const bad = (sample.match(/[\uFFFD\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
    return bad / sample.length > 0.03;
  }

  async function extractText(file) {
    const name = (file.name || '').toLowerCase();
    const type = file.type || '';
    if (name.endsWith('.pdf') || type === 'application/pdf') return extractPdf(file);
    if (name.endsWith('.docx') || type.includes('officedocument.wordprocessingml')) return extractDocx(file);
    if (
      name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm') ||
      name.endsWith('.ods') || type.includes('spreadsheet') ||
      type === 'application/vnd.ms-excel' ||
      type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) return extractXlsx(file);
    // Text-ish default. Detect binary-looking content and throw a clear error
    // so the user doesn't end up uploading mojibake.
    let text;
    try { text = await file.text(); } catch { text = ''; }
    if (looksBinary(text)) {
      throw new Error(`Формат ${file.name.split('.').pop() || 'файла'} не распознаётся как текст. Поддерживаются: PDF, DOCX, XLSX/XLS/CSV, TXT/MD/JSON/XML/YAML/RTF. Конвертируйте в один из них или вставьте текст вручную.`);
    }
    return text;
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

  function renderMarkdown(md) {
    if (!md) return '';
    const lines = md.replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
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
      if (/^\s*[-•]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-•]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-•]\s+/, ''));
          i++;
        }
        out.push('<ul class="md-list">' + items.map(x => `<li>${renderInline(x)}</li>`).join('') + '</ul>');
        continue;
      }
      if (!line.trim()) { out.push(''); i++; continue; }
      out.push(`<p class="md-p">${renderInline(line)}</p>`);
      i++;
    }
    return out.join('');
  }

  // ---------- Bot avatar SVG ----------
  const AVATAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M4 16 L9 10 L12 13 L16 8 L20 16 Z" fill="currentColor" stroke="none"/></svg>';

  // ---------- Chat ----------
  const chatEl = $('#chat');
  const formEl = $('#form');
  const inputEl = $('#input');
  const sendEl = $('#send');
  const attachBtn = $('#attach-btn');
  const attachInput = $('#attach-input');
  const attachedListEl = $('#attached-list');
  const micBtn = $('#mic-btn');

  const SUGGESTIONS = [
    'Аналоги ГОСТ',
    'Запросить цену',
    'Расшифруй маркировку',
    'Подбор по размерам',
  ];

  const SUGGESTION_PROMPTS = {
    'Аналоги ГОСТ': 'Подбери ГОСТ-аналог по маркировке: ',
    'Запросить цену': 'Запросить цену на подшипник ',
    'Расшифруй маркировку': 'Расшифруй маркировку ',
    'Подбор по размерам': 'Нужен подшипник с размерами d=_, D=_, B=_, тип _',
  };

  let messages = [];
  let pending = [];
  let streaming = false;
  let currentSessionId = newSessionId();   // fresh chat by default
  let sessionsIndex = [];                  // last /api/sessions payload

  function scrollToBottom() {
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  }

  function autoresize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }

  function setStreaming(v) {
    streaming = v;
    sendEl.disabled = v;
    attachBtn.disabled = v;
    inputEl.disabled = v;
  }

  function makeAvatar() {
    const a = document.createElement('div');
    a.className = 'avatar';
    a.innerHTML = AVATAR_SVG;
    return a;
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
    const row = document.createElement('div');
    row.className = 'msg-row user';
    const msg = document.createElement('div');
    msg.className = 'msg user';
    renderAttachmentChips(msg, atts);
    if (text) {
      const t = document.createElement('div');
      t.textContent = text;
      msg.appendChild(t);
    }
    row.appendChild(msg);
    chatEl.appendChild(row);
    scrollToBottom();
    return msg;
  }

  function appendBotMsg(content = '', { error = false } = {}) {
    const row = document.createElement('div');
    row.className = 'msg-row bot';
    row.appendChild(makeAvatar());
    const msg = document.createElement('div');
    msg.className = `msg bot${error ? ' error' : ''}`;
    msg.textContent = content;
    row.appendChild(msg);
    chatEl.appendChild(row);
    scrollToBottom();
    return msg;
  }

  function appendCursor(el) {
    const c = document.createElement('span');
    c.className = 'cursor';
    el.appendChild(c);
    return c;
  }

  function renderWelcome() {
    chatEl.innerHTML = '';

    // Greeting bubble
    const greet = document.createElement('div');
    greet.className = 'msg-row bot';
    greet.appendChild(makeAvatar());
    const greetMsg = document.createElement('div');
    greetMsg.className = 'msg bot';
    greetMsg.textContent = 'Здравствуйте! Я Бот Эверест. Чем могу помочь с подбором подшипников для вашего оборудования?';
    greet.appendChild(greetMsg);
    chatEl.appendChild(greet);

    // Topics bubble with chips
    const topics = document.createElement('div');
    topics.className = 'msg-row bot';
    topics.appendChild(makeAvatar());
    const topicsMsg = document.createElement('div');
    topicsMsg.className = 'msg bot';
    const label = document.createElement('div');
    label.innerHTML = '<strong>Вот популярные темы:</strong>';
    topicsMsg.appendChild(label);
    const chips = document.createElement('div');
    chips.className = 'chip-row';
    for (const q of SUGGESTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = q;
      b.addEventListener('click', () => {
        inputEl.value = SUGGESTION_PROMPTS[q] || q;
        autoresize();
        inputEl.focus();
      });
      chips.appendChild(b);
    }
    topicsMsg.appendChild(chips);
    topics.appendChild(topicsMsg);
    chatEl.appendChild(topics);
  }

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
          entry.text = (t || '').slice(0, 6000);
          entry.extractedChars = entry.text.length;
        } catch { /* ignore */ }
      }
      pending.push(entry);
    }
    attachInput.value = '';
    renderPending();
  });

  // ---------- Voice input ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = 'Распознавание речи не поддерживается в этом браузере';
  } else {
    recognition = new SR();
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.continuous = false;

    let base = '';
    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      inputEl.value = (base ? base + ' ' : '') + transcript;
      autoresize();
    };
    recognition.onend = () => {
      listening = false;
      micBtn.classList.remove('recording');
    };
    recognition.onerror = () => {
      listening = false;
      micBtn.classList.remove('recording');
    };

    micBtn.addEventListener('click', () => {
      if (streaming) return;
      if (listening) {
        try { recognition.stop(); } catch {}
        return;
      }
      base = inputEl.value.trim();
      try {
        recognition.start();
        listening = true;
        micBtn.classList.add('recording');
      } catch { /* already running */ }
    });
  }

  // ---------- Send ----------
  async function sendMessage(text) {
    const prompt = (text || '').trim();
    if (!prompt && pending.length === 0) return;
    if (streaming) return;

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
          session_id: currentSessionId,
          client_id: CLIENT_ID,
          attachment_text: attachmentText || undefined,
          images: imgAttachments.map(p => ({ name: p.name, dataUrl: p.dataUrl })),
        }),
      });

      if (!resp.ok) {
        const rawBody = await resp.text().catch(() => '');
        let detail = rawBody.trim();
        try {
          const j = JSON.parse(detail);
          if (j && typeof j.error === 'string') detail = j.error;
        } catch {}
        const statusLabel = `HTTP ${resp.status}${resp.statusText ? ' ' + resp.statusText : ''}`;
        const hint = resp.status === 404
          ? ' — маршрут /api/chat не найден на сервере (проверьте деплой воркера)'
          : '';
        const msg = (detail.slice(0, 150) || statusLabel) + hint;
        throw new Error(msg.slice(0, 240));
      }
      if (!resp.body) throw new Error('Пустой ответ от сервера');

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
      if (botText) botEl.innerHTML = renderMarkdown(botText);
      else botEl.textContent = '(пустой ответ)';
      messages.push({ role: 'assistant', content: botText });
      // Refresh sidebar so the just-persisted session shows up with its
      // auto-generated title. Runs after the stream body is fully consumed.
      loadSessions();
    } catch (e) {
      cursor.remove();
      botEl.parentElement?.remove();
      const detail = (typeof e === 'string' ? e : e?.message)?.trim() || 'не удалось получить ответ от бота';
      appendBotMsg(`Ошибка: ${detail}`, { error: true });
      messages.pop();
    } finally {
      setStreaming(false);
      inputEl.focus();
    }
  }

  function clearChat() {
    if (streaming) return;
    messages = [];
    pending = [];
    renderPending();
    renderWelcome();
    inputEl.focus();
  }

  formEl.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(inputEl.value); });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value); }
  });
  inputEl.addEventListener('input', autoresize);

  // ---------- Sidebar: chat list ----------
  const chatListEl = $('#chat-list');
  const newChatBtn = $('#new-chat-btn');

  function fmtRowTime(iso) {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const daysAgo = Math.floor((now - d) / 86400000);
    if (daysAgo < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  function renderSidebar() {
    chatListEl.innerHTML = '';
    if (!sessionsIndex.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-list-empty';
      empty.textContent = 'Пока пусто. Задайте первый вопрос — чат появится здесь.';
      chatListEl.appendChild(empty);
      return;
    }
    for (const s of sessionsIndex) {
      // Row is a div (not button) because it contains a nested delete button —
      // nesting <button> inside <button> is invalid HTML and browsers collapse
      // the inner click in unpredictable ways.
      const row = document.createElement('div');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.className = 'chat-row' + (s.id === currentSessionId ? ' active' : '');
      row.dataset.sid = s.id;

      const avatar = document.createElement('span');
      avatar.className = 'chat-row-avatar';
      avatar.innerHTML = AVATAR_SVG;
      row.appendChild(avatar);

      const body = document.createElement('span');
      body.className = 'chat-row-body';
      const name = document.createElement('span');
      name.className = 'chat-row-name';
      name.textContent = (s.title && s.title.trim()) || 'Новый чат';
      const sub = document.createElement('span');
      sub.className = 'chat-row-sub';
      const count = Number(s.message_count || 0);
      sub.textContent = count ? `${count} сообщ.` : 'пусто';
      body.appendChild(name);
      body.appendChild(sub);
      row.appendChild(body);

      const right = document.createElement('span');
      right.style.display = 'inline-flex';
      right.style.flexDirection = 'column';
      right.style.alignItems = 'flex-end';
      right.style.gap = '4px';
      const time = document.createElement('span');
      time.className = 'chat-row-time';
      time.textContent = fmtRowTime(s.updated_at || s.created_at);
      right.appendChild(time);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chat-row-menu';
      del.title = 'Удалить чат';
      del.setAttribute('aria-label', 'Удалить чат');
      del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(s.id);
      });
      right.appendChild(del);
      row.appendChild(right);

      row.addEventListener('click', () => openSession(s.id));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSession(s.id); }
      });
      chatListEl.appendChild(row);
    }
  }

  async function loadSessions() {
    try {
      const r = await fetch('/api/sessions?client_id=' + encodeURIComponent(CLIENT_ID));
      const j = await r.json();
      if (!j.ok) return;
      sessionsIndex = j.sessions || [];
      renderSidebar();
    } catch { /* offline — ignore */ }
  }

  async function openSession(sid) {
    if (streaming) return;
    if (sid === currentSessionId) { toggleSidebar(false); return; }
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(sid)}/messages?client_id=${encodeURIComponent(CLIENT_ID)}`);
      const j = await r.json();
      if (!j.ok) return;
      currentSessionId = sid;
      messages = [];
      pending = [];
      renderPending();
      chatEl.innerHTML = '';
      for (const m of (j.messages || [])) {
        if (m.role === 'user') {
          messages.push({ role: 'user', content: m.content });
          appendUserMsg(m.content, []);
        } else if (m.role === 'assistant') {
          messages.push({ role: 'assistant', content: m.content });
          const el = appendBotMsg('');
          el.innerHTML = renderMarkdown(m.content);
        }
      }
      if (!messages.length) renderWelcome();
      renderSidebar();
      toggleSidebar(false);
    } catch { /* ignore */ }
  }

  function newChat() {
    if (streaming) return;
    currentSessionId = newSessionId();
    messages = [];
    pending = [];
    renderPending();
    renderWelcome();
    renderSidebar();
    toggleSidebar(false);
    inputEl.focus();
  }

  async function deleteSession(sid) {
    if (streaming) return;
    if (!confirm('Удалить этот чат?')) return;
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(sid)}?client_id=${encodeURIComponent(CLIENT_ID)}`, {
        method: 'DELETE',
      });
      const j = await r.json();
      if (!j.ok) return;
      if (sid === currentSessionId) {
        currentSessionId = newSessionId();
        messages = [];
        pending = [];
        renderPending();
        renderWelcome();
      }
      await loadSessions();
    } catch { /* ignore */ }
  }

  newChatBtn?.addEventListener('click', newChat);

  renderWelcome();
  renderSidebar();
  loadSessions();
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

  try { tokenEl.value = sessionStorage.getItem('ai-kb-admin') || ''; } catch {}

  function setStatus(msg, kind = 'info') {
    statusEl.hidden = !msg;
    statusEl.className = 'upload-status ' + kind;
    statusEl.textContent = msg || '';
  }

  // ---------- Settings (prompt + params) ----------
  const promptEl = $('#prompt-editor');
  const promptSaveBtn = $('#prompt-save');
  const promptResetBtn = $('#prompt-reset');
  const promptStatus = $('#prompt-status');
  const pTemp = $('#p-temp');
  const pMaxTok = $('#p-maxtok');
  const pCatK = $('#p-catk');
  const pVecK = $('#p-veck');
  const paramsSaveBtn = $('#params-save');
  const paramsStatus = $('#params-status');

  // Remember factory default for the reset button.
  let factoryPrompt = '';
  let settingsLoaded = false;

  function setInline(el, msg, kind = '') {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.className = 'inline-status' + (kind ? ' ' + kind : '');
  }

  async function loadSettings() {
    try {
      const r = await fetch('/api/settings');
      const j = await r.json();
      if (!j.ok) return;
      const s = j.settings || {};
      const ov = s._overrides || {};
      // Factory prompt = whatever comes back when no override is set.
      if (!ov.system_prompt) factoryPrompt = s.system_prompt || factoryPrompt;
      else if (!factoryPrompt) factoryPrompt = s.system_prompt || '';
      if (promptEl) promptEl.value = s.system_prompt || '';
      if (pTemp) pTemp.value = s.temperature || '';
      if (pMaxTok) pMaxTok.value = s.max_tokens || '';
      if (pCatK) pCatK.value = s.catalog_topk || '';
      if (pVecK) pVecK.value = s.vector_topk || '';
      settingsLoaded = true;
    } catch { /* ignore */ }
  }
  loadSettings();

  async function saveSettings(patch, statusEl) {
    const token = tokenEl.value.trim();
    if (!token) { setInline(statusEl, 'Введите токен администратора', 'error'); return false; }
    try { sessionStorage.setItem('ai-kb-admin', token); } catch {}
    setInline(statusEl, 'Сохраняю…');
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ settings: patch }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setInline(statusEl, 'Сохранено', 'success');
      setTimeout(() => setInline(statusEl, ''), 2500);
      return true;
    } catch (e) {
      setInline(statusEl, 'Ошибка: ' + (e.message || e), 'error');
      return false;
    }
  }

  promptSaveBtn?.addEventListener('click', () => {
    const text = promptEl?.value?.trim() || '';
    if (text.length < 20) { setInline(promptStatus, 'Промпт слишком короткий', 'error'); return; }
    saveSettings({ system_prompt: text }, promptStatus);
  });

  promptResetBtn?.addEventListener('click', async () => {
    if (!confirm('Сбросить промпт к заводскому?')) return;
    if (await saveSettings({ system_prompt: '' }, promptStatus)) {
      await loadSettings();
    }
  });

  paramsSaveBtn?.addEventListener('click', () => {
    const patch = {
      temperature: pTemp?.value?.trim() || '',
      max_tokens: pMaxTok?.value?.trim() || '',
      catalog_topk: pCatK?.value?.trim() || '',
      vector_topk: pVecK?.value?.trim() || '',
    };
    saveSettings(patch, paramsStatus);
  });

  fileEl.addEventListener('change', async () => {
    const f = fileEl.files?.[0];
    if (!f) return;
    if (!titleEl.value.trim()) titleEl.value = f.name.replace(/\.[^.]+$/, '');
    setStatus(`Извлекаю текст из ${f.name}…`, 'info');
    try {
      const text = await extractText(f);
      textEl.value = (text || '').slice(0, 300000);
      if (!textEl.value) setStatus(`Файл ${f.name} не содержит распознанного текста.`, 'error');
      else setStatus(`Извлечено ${text.length.toLocaleString('ru')} символов.`, 'success');
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

    try { sessionStorage.setItem('ai-kb-admin', token); } catch {}
    setStatus('Индексирую…', 'info');
    uploadBtn.disabled = true;
    try {
      const r = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ title, text, category, source: fileEl.files?.[0]?.name || 'manual' }),
      });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        // Cloudflare edge (413/502/504) returns HTML; give the user a clear
        // status code instead of a JSON parse crash.
        const body = await r.text().catch(() => '');
        const hint = r.status === 413 ? ' — документ слишком большой, разбейте на части' : '';
        throw new Error(`HTTP ${r.status} ${r.statusText || ''}${hint}`.trim() || body.slice(0, 120));
      }
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setStatus(`Готово. Добавлено ${j.chunks} фрагментов (ID ${j.kb_id}).`, 'success');
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
    if (!confirm('Перестроить индекс по всем записям knowledge_base?')) return;
    try { sessionStorage.setItem('ai-kb-admin', token); } catch {}
    reindexBtn.disabled = true;
    let afterId = 0;
    let chunkFrom = 0;
    let totalChunks = 0;
    let rowsDone = 0;
    const RETRY_DELAYS = [1500, 3000, 6000];

    try {
      outer: while (true) {
        setStatus(`Переиндексирую: записей ${rowsDone}, фрагментов ${totalChunks}…`, 'info');
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
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          }
        }
        if (!j) {
          setStatus(`Пропускаю (after_id=${afterId}, chunk_from=${chunkFrom}): ${lastErr?.message || 'ошибка'}`, 'error');
          await new Promise(r => setTimeout(r, 1200));
          if (chunkFrom > 0) chunkFrom = 0;
          else afterId += 1;
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
      setStatus(`Прервано: ${e.message || e}`, 'error');
    } finally {
      reindexBtn.disabled = false;
    }
  });
})();
