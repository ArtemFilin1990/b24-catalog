// ai-kb/src/files.js
// Admin file registry: upload originals to R2, track metadata in D1.
// Extraction/chunking/embedding will land in a follow-up PR.
//
// Depends on migration 0002_files_rules_catalog.sql (files table).
// R2 key layout: ai-kb/files/<sha256>

const R2_PREFIX = 'ai-kb/files/';
// Workers have a 128 MB memory ceiling per request, and request.arrayBuffer()
// materializes the full body in memory on top of R2/D1 client overhead and
// the SHA-256 digest working buffer. 25 MB is a safe ceiling for a standard
// Worker; larger uploads need streaming or a multipart/presigned-URL flow
// which is tracked in the P1 follow-up issue.
const MAX_UPLOAD_BYTES = 25_000_000;
const MAX_LIST_LIMIT = 200;

// ---- source_type enum (must match CHECK in 0002 migration) ----
const SOURCE_TYPES = new Set([
  'pdf','xlsx','xls','csv','docx','txt','md','json','xml','yaml',
  'image','audio','other',
]);

// ---- STATUS enum (must match CHECK in 0002) ----
const ALLOWED_STATUSES = new Set([
  'uploaded','stored','parsed','indexed','partial','failed','archived','deleted',
]);

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function detectSourceType(name, mime) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m.includes('wordprocessingml')) return 'docx';
  if (m.includes('spreadsheetml') || m === 'application/vnd.ms-excel') {
    return extOf(name) === 'xls' ? 'xls' : 'xlsx';
  }
  if (m === 'text/csv') return 'csv';
  if (m === 'application/json') return 'json';
  if (m === 'application/xml' || m === 'text/xml') return 'xml';
  if (m === 'application/yaml' || m === 'text/yaml' || m === 'application/x-yaml') return 'yaml';
  if (m === 'text/markdown') return 'md';
  if (m.startsWith('text/')) return extOf(name) === 'md' ? 'md' : 'txt';

  const ext = extOf(name);
  if (SOURCE_TYPES.has(ext)) return ext;
  if (ext === 'yml') return 'yaml';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp' || ext === 'gif' || ext === 'bmp') return 'image';
  if (ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'm4a' || ext === 'flac') return 'audio';
  return 'other';
}

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Audit writes share the `admin_audit_log` table owned by the root worker
// (schema in migrations/0001_root_schema.sql): columns action, resource, meta,
// ip, ua, created_at. The 0002 ai-kb migration defines a different shape of
// the same table but IF NOT EXISTS keeps the earlier one; the prod truth is
// the root schema. Follow-up PR will reconcile.
//
// Wrapped in try/catch so audit failures never fail the real request.
async function audit(env, request, action, resource, meta) {
  try {
    await env.DB
      .prepare('INSERT INTO admin_audit_log (action, resource, meta, ip, ua) VALUES (?, ?, ?, ?, ?)')
      .bind(
        String(action).slice(0, 80),
        resource == null ? null : String(resource).slice(0, 200),
        meta ? JSON.stringify(meta).slice(0, 2000) : null,
        (request.headers.get('CF-Connecting-IP') || '').slice(0, 64) || null,
        (request.headers.get('User-Agent') || '').slice(0, 200) || null,
      )
      .run();
  } catch { /* audit must not break the request */ }
}

// Distinguish "the tables aren't there yet" from real bugs so the operator
// gets an actionable 503 instead of a generic 500.
function isMigrationMissing(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('no such table') || msg.includes('no such column');
}

// SQLite reports UNIQUE violations with code SQLITE_CONSTRAINT_UNIQUE; D1
// surfaces this in the message.
function isUniqueViolation(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('unique constraint') || msg.includes('constraint failed')
      || msg.includes('sqlite_constraint_unique');
}

function migrationError(res) {
  return res.jsonErr(
    'Migration 0002_files_rules_catalog.sql is not applied. Run: wrangler d1 execute baza --remote --file ai-kb/migrations/0002_files_rules_catalog.sql',
    503
  );
}

// ============================================================
// POST /api/admin/files/upload
//   body:    raw file bytes (any Content-Type, ≤ 95 MB)
//   query:   ?name=<original-name>   required
//            &mime=<override>        optional
//            &notes=<text>           optional
//   returns: { ok, file_id, r2_key, sha256, deduped, size_bytes }
// ============================================================
export async function handleAdminFilesUpload(request, env, { jsonOk, jsonErr, requireAdmin }) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name) return jsonErr('query param "name" required');
  if (name.length > 500) return jsonErr('"name" too long');

  const mimeFromQuery = url.searchParams.get('mime') || '';
  const mime = mimeFromQuery || request.headers.get('content-type') || 'application/octet-stream';
  const notes = url.searchParams.get('notes') || null;

  const lenHeader = Number(request.headers.get('content-length') || 0);
  if (lenHeader && lenHeader > MAX_UPLOAD_BYTES) {
    return jsonErr(`Body exceeds ${MAX_UPLOAD_BYTES} bytes`, 413);
  }

  const buf = await request.arrayBuffer();
  const size = buf.byteLength;
  if (size === 0) return jsonErr('Empty body', 400);
  if (size > MAX_UPLOAD_BYTES) return jsonErr(`Body exceeds ${MAX_UPLOAD_BYTES} bytes`, 413);

  const sha = await sha256Hex(buf);
  const r2Key = `${R2_PREFIX}${sha}`;
  const sourceType = detectSourceType(name, mime);

  // SHA-based dedup. Matching rows can be in any status:
  //   - non-deleted  → return the existing id as deduped
  //   - soft-deleted → "resurrect" back to 'stored' and return as deduped
  // This covers the UNIQUE(r2_key) constraint: soft-deleted rows still hold
  // the key, so we must treat them as live instead of letting the later
  // INSERT collide with them.
  let existing;
  try {
    existing = await env.DB
      .prepare('SELECT id, r2_key, size_bytes, status FROM files WHERE sha256 = ? LIMIT 1')
      .bind(sha)
      .first();
  } catch (e) {
    if (isMigrationMissing(e)) return migrationError({ jsonErr });
    return jsonErr(`DB error: ${e.message}`, 500);
  }
  if (existing) {
    const resurrected = existing.status === 'deleted';
    // If the re-upload carries fresher metadata (new original_name, mime,
    // notes) reflect it. size_bytes is re-bound too for defensiveness even
    // though same-sha256 means same byte-length in practice.
    try {
      await env.DB
        .prepare(
          resurrected
            ? `UPDATE files SET status='stored', original_name=?, mime_type=?, notes=?, size_bytes=? WHERE id=?`
            : `UPDATE files SET original_name=?, mime_type=?, notes=?, size_bytes=? WHERE id=?`
        )
        .bind(name, mime, notes, size, existing.id)
        .run();
    } catch (e) {
      return jsonErr(`DB update failed: ${e.message}`, 500);
    }
    await audit(env, request, 'files.upload', existing.id, {
      sha256: sha, size, source_type: sourceType, deduped: true, resurrected,
    });
    return jsonOk({
      file_id: existing.id,
      r2_key: existing.r2_key,
      sha256: sha,
      size_bytes: size,
      deduped: true,
      resurrected,
    });
  }

  // Put to R2 first — if this fails we have no orphan D1 row.
  try {
    await env.CATALOG.put(r2Key, buf, {
      httpMetadata: { contentType: mime },
      customMetadata: { original_name: name, sha256: sha },
    });
  } catch (e) {
    return jsonErr(`R2 put failed: ${e.message}`, 502);
  }

  let insert;
  try {
    insert = await env.DB
      .prepare(
        `INSERT INTO files (source_type, original_name, mime_type, r2_key, sha256, size_bytes, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, 'stored', ?)`
      )
      .bind(sourceType, name, mime, r2Key, sha, size, notes)
      .run();
  } catch (e) {
    if (isMigrationMissing(e)) {
      // Our R2 put is orphaned because the table doesn't exist; safe to
      // remove since no other row can reference it.
      try { await env.CATALOG.delete(r2Key); } catch {}
      return migrationError({ jsonErr });
    }
    if (isUniqueViolation(e)) {
      // A concurrent upload of the same bytes won the race. The R2 object
      // is shared — do NOT delete it, that would break the winning row.
      // Fall back to returning that row as deduped.
      let winner;
      try {
        winner = await env.DB
          .prepare('SELECT id, r2_key, size_bytes FROM files WHERE sha256 = ? LIMIT 1')
          .bind(sha)
          .first();
      } catch {}
      if (winner) {
        await audit(env, request, 'files.upload', winner.id, {
          sha256: sha, size, source_type: sourceType, deduped: true, race: true,
        });
        return jsonOk({
          file_id: winner.id,
          r2_key: winner.r2_key,
          sha256: sha,
          size_bytes: winner.size_bytes,
          deduped: true,
          race: true,
        });
      }
      return jsonErr(`DB insert failed: ${e.message}`, 500);
    }
    // Any other DB failure: our R2 put is definitely orphan (no row points
    // to it), remove it.
    try { await env.CATALOG.delete(r2Key); } catch {}
    return jsonErr(`DB insert failed: ${e.message}`, 500);
  }

  const fileId = insert.meta?.last_row_id;
  await audit(env, request, 'files.upload', fileId, {
    sha256: sha, size, source_type: sourceType, deduped: false,
  });
  return jsonOk({
    file_id: fileId,
    r2_key: r2Key,
    sha256: sha,
    size_bytes: size,
    source_type: sourceType,
    deduped: false,
  });
}

// ============================================================
// GET /api/admin/files
//   query: ?limit=50&after_id=0&status=stored&source_type=pdf
//   returns: { ok, files: [...], next_after_id }
// ============================================================
export async function handleAdminFilesList(request, env, { jsonOk, jsonErr, requireAdmin }) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Number(url.searchParams.get('limit') || 50)));
  const afterId = Math.max(0, Number(url.searchParams.get('after_id') || 0));
  const status = url.searchParams.get('status');
  const sourceType = url.searchParams.get('source_type');

  const conds = ['id > ?'];
  const bindings = [afterId];
  if (status) {
    if (!ALLOWED_STATUSES.has(status)) return jsonErr('invalid status');
    conds.push('status = ?'); bindings.push(status);
  }
  if (sourceType) {
    if (!SOURCE_TYPES.has(sourceType)) return jsonErr('invalid source_type');
    conds.push('source_type = ?'); bindings.push(sourceType);
  }
  bindings.push(limit);

  let rows;
  try {
    const r = await env.DB
      .prepare(
        `SELECT id, source_type, original_name, mime_type, r2_key, sha256, size_bytes, status,
                parse_error, notes, created_at, updated_at
         FROM files
         WHERE ${conds.join(' AND ')}
         ORDER BY id ASC
         LIMIT ?`
      )
      .bind(...bindings)
      .all();
    rows = r.results || [];
  } catch (e) {
    if (isMigrationMissing(e)) return migrationError({ jsonErr });
    return jsonErr(`DB error: ${e.message}`, 500);
  }

  await audit(env, request, 'files.list', null, {
    count: rows.length, limit, after_id: afterId, status, source_type: sourceType,
  });
  return jsonOk({
    files: rows,
    next_after_id: rows.length === limit ? rows[rows.length - 1].id : null,
  });
}

// ============================================================
// DELETE /api/admin/files/:id
//   query: ?hard=1   also remove R2 object (default: soft — keep object,
//                    just mark status='deleted')
//   returns: { ok, file_id, soft, r2_deleted }
// ============================================================
export async function handleAdminFilesDelete(request, env, id, { jsonOk, jsonErr, requireAdmin }) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);

  const fileId = Number(id);
  if (!Number.isInteger(fileId) || fileId <= 0) return jsonErr('invalid file id');

  const hard = new URL(request.url).searchParams.get('hard') === '1';

  let row;
  try {
    row = await env.DB.prepare('SELECT id, r2_key, status FROM files WHERE id = ?').bind(fileId).first();
  } catch (e) {
    if (isMigrationMissing(e)) return migrationError({ jsonErr });
    return jsonErr(`DB error: ${e.message}`, 500);
  }
  if (!row) return jsonErr('not found', 404);

  // Update DB first, then best-effort R2 delete. If R2 fails we leave an
  // orphan object (reconciled later by the cleanup cron), which is safer
  // than a DB row pointing at a missing object.
  try {
    await env.DB
      .prepare("UPDATE files SET status = 'deleted' WHERE id = ?")
      .bind(fileId)
      .run();
  } catch (e) {
    return jsonErr(`DB update failed: ${e.message}`, 500);
  }

  let r2Deleted = false;
  let r2DeleteError = null;
  if (hard) {
    try { await env.CATALOG.delete(row.r2_key); r2Deleted = true; }
    catch (e) { r2DeleteError = e.message; }
  }

  await audit(env, request, 'files.delete', fileId, {
    hard, r2_deleted: r2Deleted, r2_delete_error: r2DeleteError, previous_status: row.status,
  });
  return jsonOk({
    file_id: fileId,
    soft: !hard,
    r2_deleted: r2Deleted,
    r2_delete_error: r2DeleteError,
  });
}

// ============================================================
// GET /api/admin/storage/stats
//   returns per-status and per-source_type counts + total bytes
// ============================================================
export async function handleAdminStorageStats(request, env, { jsonOk, jsonErr, requireAdmin }) {
  if (!requireAdmin(request, env)) return jsonErr('Forbidden', 403);

  try {
    const byStatus = await env.DB
      .prepare(`SELECT status, COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes
                FROM files GROUP BY status ORDER BY n DESC`)
      .all();

    const byType = await env.DB
      .prepare(`SELECT source_type, COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes
                FROM files WHERE status != 'deleted' GROUP BY source_type ORDER BY n DESC`)
      .all();

    const totals = await env.DB
      .prepare(`SELECT COUNT(*) AS total_files,
                       COALESCE(SUM(size_bytes), 0) AS total_bytes,
                       COALESCE(SUM(CASE WHEN status='deleted' THEN size_bytes ELSE 0 END), 0) AS deleted_bytes
                FROM files`)
      .first();

    await audit(env, request, 'storage.stats', null, {
      total_files: totals?.total_files ?? 0,
      total_bytes: totals?.total_bytes ?? 0,
    });
    return jsonOk({
      by_status: byStatus.results || [],
      by_source_type: byType.results || [],
      totals: totals || {},
    });
  } catch (e) {
    if (isMigrationMissing(e)) return migrationError({ jsonErr });
    return jsonErr(`DB error: ${e.message}`, 500);
  }
}
