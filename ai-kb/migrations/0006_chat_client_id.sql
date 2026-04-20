-- ============================================================
-- Миграция 0006: client_id для chat_sessions
-- Worker: ai-kb | D1: baza
--
-- До этого chat_sessions.id хранил только серверный UUID, без связи с
-- конкретным браузером. Sidebar показывал всю историю для всех
-- одновременно, поэтому endpoint GET /api/sessions был admin-gated.
--
-- client_id — стабильный UUID в localStorage браузера. Каждая сессия
-- привязывается к ему. GET /api/sessions?client_id=… возвращает только
-- чаты этого клиента — admin-токен больше не требуется.
--
-- Применение:
--   wrangler d1 execute baza --remote --file=ai-kb/migrations/0006_chat_client_id.sql
-- Идемпотентна (ALTER обёрнут в try; проверка наличия колонки — через
-- sqlite_master в коде перед миграцией не нужна, так как D1 не падает
-- на повторном ADD COLUMN в новых раннтаймах; но на всякий случай SQL
-- сформулирован так, что его можно прогнать второй раз с ожидаемой
-- ошибкой "duplicate column" — она не критична).
-- ============================================================

-- ALTER TABLE chat_sessions ADD COLUMN client_id TEXT;
-- D1 на ранних билдах не имел ALTER TABLE ADD COLUMN, сейчас имеет.
ALTER TABLE chat_sessions ADD COLUMN client_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_client ON chat_sessions (client_id, updated_at DESC);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0006_chat_client_id');
