const chatEl = document.getElementById('chat');
const formEl = document.getElementById('form');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');
const clearEl = document.getElementById('clear-btn');

const EXAMPLES = [
  'Что означает маркировка 6205-2RS?',
  'Подбери аналог SKF 6305 от NSK',
  'Чем C3 отличается от C0?',
  'Какие размеры у 22210 EK?',
];

let messages = [];
let streaming = false;

function renderEmptyState() {
  chatEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  wrap.innerHTML = `
    <div>Привет! Я помогу с подбором и характеристиками подшипников.</div>
    <div class="examples"></div>
  `;
  const examples = wrap.querySelector('.examples');
  for (const ex of EXAMPLES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'example-chip';
    chip.textContent = ex;
    chip.addEventListener('click', () => {
      inputEl.value = ex;
      autoresize();
      inputEl.focus();
    });
    examples.appendChild(chip);
  }
  chatEl.appendChild(wrap);
}

function clearEmptyState() {
  const empty = chatEl.querySelector('.empty-state');
  if (empty) empty.remove();
}

function appendMsg(role, content, { error = false } = {}) {
  clearEmptyState();
  const el = document.createElement('div');
  el.className = `msg ${role}${error ? ' error' : ''}`;
  el.textContent = content;
  chatEl.appendChild(el);
  scrollToBottom();
  return el;
}

function appendCursor(el) {
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  el.appendChild(cursor);
  return cursor;
}

function scrollToBottom() {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
}

function autoresize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
}

function setStreaming(val) {
  streaming = val;
  sendEl.disabled = val;
  inputEl.disabled = val;
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || streaming) return;

  messages.push({ role: 'user', content: trimmed });
  appendMsg('user', trimmed);

  inputEl.value = '';
  autoresize();

  const botEl = appendMsg('bot', '');
  const cursorEl = appendCursor(botEl);
  let botText = '';

  setStreaming(true);

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
      throw new Error(errText);
    }
    if (!resp.body) throw new Error('Пустой ответ сервера');

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
            cursorEl.remove();
            botEl.textContent = botText;
            botEl.appendChild(cursorEl);
            scrollToBottom();
          }
        } catch { /* skip malformed chunk */ }
      }
    }

    cursorEl.remove();
    botEl.textContent = botText || '(пустой ответ)';
    messages.push({ role: 'assistant', content: botText });
  } catch (e) {
    cursorEl.remove();
    botEl.remove();
    appendMsg('bot', `Ошибка: ${e.message || e}`, { error: true });
    messages.pop();
  } finally {
    setStreaming(false);
    inputEl.focus();
  }
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(inputEl.value);
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
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
