// src/index.js
// b24-catalog Worker: отдаёт каталог, хранит импорты и заявки в D1 базе.

const BITRIX_WEBHOOK = 'https://ewerest.bitrix24.ru/rest/1/7p899kjck8sh8b3x';

const COMMON_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'self' https://*.bitrix24.ru https://*.bitrix24.com https://*.bitrix24.eu",
  'X-Frame-Options': 'ALLOWALL',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JSON_HEADERS = {
  ...COMMON_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function jsonOk(data, extra = {}) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { ...JSON_HEADERS, ...extra }
  });
}

function jsonErr(message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: JSON_HEADERS
  });
}

async function readJSON(request) {
  try { return await request.json(); }
  catch (e) { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: COMMON_HEADERS });
    }

    // === API ===

    if (path === '/api/ping') {
      return jsonOk({ app: 'b24-catalog', time: new Date().toISOString() });
    }

    if (path === '/api/imports' && method === 'GET') {
      try {
        const rs = await env.DB.prepare(
          'SELECT id, source, uploaded_at, uploaded_by, session_id, data FROM imported_rows WHERE deleted = 0 ORDER BY uploaded_at DESC LIMIT 10000'
        ).all();
        const rows = (rs.results || []).map(r => {
          try {
            const parsed = JSON.parse(r.data);
            return { ...parsed, _import_id: r.id, _source: r.source, _uploaded_at: r.uploaded_at };
          } catch (e) { return null; }
        }).filter(Boolean);
        return jsonOk({ rows, count: rows.length });
      } catch (e) {
        return jsonErr('DB read failed: ' + e.message, 500);
      }
    }

    if (path === '/api/imports' && method === 'POST') {
      const body = await readJSON(request);
      if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
        return jsonErr('rows[] required', 400);
      }
      const source = String(body.source || 'manual').slice(0, 64);
      const filename = String(body.filename || '').slice(0, 255);
      const format = String(body.format || '').slice(0, 16);
      const uploadedBy = String(body.uploaded_by || 'anonymous').slice(0, 128);
      const sessionId = String(body.session_id || crypto.randomUUID()).slice(0, 64);

      try {
        await env.DB.prepare(
          'INSERT OR REPLACE INTO import_sessions (id, uploaded_by, filename, format, rows_count, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(sessionId, uploadedBy, filename, format, body.rows.length, 'active').run();

        const stmts = body.rows.map(row => {
          const dataJson = JSON.stringify(row);
          return env.DB.prepare(
            `INSERT INTO imported_rows 
            (source, uploaded_by, session_id, data, base_number, brand, price_rub, quantity, diam_inner_mm, diam_outer_mm, width_mm)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            source, uploadedBy, sessionId, dataJson,
            row.base_number || null, row.brand || null,
            row.price_rub ? Number(row.price_rub) : null,
            row.quantity ? Number(row.quantity) : null,
            row.d_mm ? Number(row.d_mm) : null,
            row.D_mm ? Number(row.D_mm) : null,
            row.B_mm ? Number(row.B_mm) : null
          );
        });
        const results = await env.DB.batch(stmts);
        return jsonOk({ session_id: sessionId, inserted: results.length, source: source });
      } catch (e) {
        return jsonErr('DB write failed: ' + e.message, 500);
      }
    }

    if (path.startsWith('/api/imports/') && method === 'DELETE') {
      const sessionId = path.substring('/api/imports/'.length);
      try {
        const rs = await env.DB.prepare(
          'UPDATE imported_rows SET deleted = 1 WHERE session_id = ? AND deleted = 0'
        ).bind(sessionId).run();
        return jsonOk({ deleted: rs.meta?.changes || 0 });
      } catch (e) {
        return jsonErr('DB delete failed: ' + e.message, 500);
      }
    }

    if (path === '/api/sessions' && method === 'GET') {
      try {
        const rs = await env.DB.prepare(
          'SELECT id, uploaded_at, uploaded_by, filename, format, rows_count, status FROM import_sessions ORDER BY uploaded_at DESC LIMIT 200'
        ).all();
        return jsonOk({ sessions: rs.results || [] });
      } catch (e) {
        return jsonErr('DB read failed: ' + e.message, 500);
      }
    }

    if (path === '/api/orders' && method === 'POST') {
      const body = await readJSON(request);
      if (!body || !body.contact) {
        return jsonErr('contact{} required', 400);
      }
      const contact = body.contact;
      if (!contact.phone && !contact.email) {
        return jsonErr('contact.phone или contact.email обязательны', 400);
      }
      const items = Array.isArray(body.items) ? body.items : [];
      const total = Number(body.total || 0);
      const orderDate = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

      const dealTitle = `Заявка с каталога — ${contact.company || contact.name || 'клиент'} — ${orderDate}`;
      const comments = [
        `Заявка с каталога ewerest.ru от ${orderDate}`,
        '',
        `Компания: ${contact.company || '[[TBD]]'}`,
        `ИНН: ${contact.inn || '[[TBD]]'}`,
        `Контакт: ${contact.name || '[[TBD]]'}`,
        `Телефон: ${contact.phone || '[[TBD]]'}`,
        `Email: ${contact.email || '[[TBD]]'}`,
        '',
        contact.comment ? `Комментарий:\n${contact.comment}\n` : '',
        `Состав (${items.length} поз., ${total.toLocaleString('ru-RU')} ₽):`,
        ...items.map((it, i) =>
          `${i + 1}. ${it.article || it.base_number} — ${it.qty || it.quantity} шт` +
          (it.price > 0 ? ` × ${it.price} ₽` : ' (по запросу)')
        )
      ].filter(Boolean).join('\n');

      let dealId = null;
      let bitrixError = null;

      try {
        const dealRes = await fetch(`${BITRIX_WEBHOOK}/crm.deal.add.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              TITLE: dealTitle, COMMENTS: comments, OPPORTUNITY: total,
              CURRENCY_ID: 'RUB', TYPE_ID: 'SALE', CATEGORY_ID: 87,
              SOURCE_ID: 'WEB', SOURCE_DESCRIPTION: 'Каталог ewerest.ru',
              ASSIGNED_BY_ID: 1
            }
          })
        });
        const dealData = await dealRes.json();
        if (dealData.error) {
          bitrixError = dealData.error_description || dealData.error;
        } else {
          dealId = dealData.result;
          if (items.length > 0) {
            const productRows = items.map(it => ({
              PRODUCT_NAME: it.article || it.base_number || 'Позиция',
              PRICE: Number(it.price || 0),
              QUANTITY: Number(it.qty || it.quantity || 1),
              TAX_RATE: 22, TAX_INCLUDED: 'Y',
              MEASURE_CODE: 796, MEASURE_NAME: 'шт'
            }));
            await fetch(`${BITRIX_WEBHOOK}/crm.deal.productrows.set.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: dealId, rows: productRows })
            });
          }
        }
      } catch (e) {
        bitrixError = e.message;
      }

      try {
        const rs = await env.DB.prepare(
          `INSERT INTO orders (bitrix_deal_id, company_name, inn, contact_name, phone, email, comment, total_rub, items_json, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          dealId, contact.company || null, contact.inn || null,
          contact.name || null, contact.phone || null, contact.email || null,
          contact.comment || null, total, JSON.stringify(items),
          bitrixError ? 'bitrix_failed' : 'sent'
        ).run();
        return jsonOk({
          order_id: rs.meta?.last_row_id, bitrix_deal_id: dealId, bitrix_error: bitrixError
        });
      } catch (e) {
        return jsonErr('DB write failed: ' + e.message, 500);
      }
    }

    if (path === '/api/orders' && method === 'GET') {
      try {
        const rs = await env.DB.prepare(
          'SELECT * FROM orders ORDER BY created_at DESC LIMIT 100'
        ).all();
        return jsonOk({ orders: rs.results || [] });
      } catch (e) {
        return jsonErr('DB read failed: ' + e.message, 500);
      }
    }

    // === STATIC ASSETS ===

    if (path === '/install' || path === '/install.html') {
      return env.ASSETS.fetch(new Request(`${url.origin}/install.html`, request));
    }

    if (path === '/' || path === '/app') {
      return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
    }

    if (method === 'POST' && (path === '/' || path === '/app')) {
      return env.ASSETS.fetch(new Request(`${url.origin}/install.html`, request));
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const newHeaders = new Headers(assetResponse.headers);
    for (const [k, v] of Object.entries(COMMON_HEADERS)) {
      newHeaders.set(k, v);
    }
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers: newHeaders
    });
  }
};
