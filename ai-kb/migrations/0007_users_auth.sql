-- ============================================================
-- Миграция 0007: users + user_sessions (простая авторизация)
-- Worker: ai-kb | D1: baza
--
-- Почему просто username+password, а не email/OAuth:
-- пользователь запросил «вписать имя и придумать пароль» — никаких
-- подтверждений почты и сторонних провайдеров. Этой таблицы хватает,
-- чтобы каждый пользователь видел только свою историю чатов.
--
-- Формат хранения пароля:
--   PBKDF2-SHA256, 100 000 итераций, 16-байтовая соль (hex).
--   sha256-хэш в hex, длина 64 символа.
--   Сам пароль нигде не пишется — только hash+salt.
--
-- Токен сессии (user_sessions.token): 32 случайных байта hex.
-- Живёт 30 дней с момента выдачи. Клиент хранит его в localStorage
-- и шлёт в `Authorization: Bearer <token>`.
--
-- Связь с chat_sessions: после логина сервер использует user.id как
-- effective client_id при записи/чтении чатов. Анонимные чаты
-- (client_id = browser-UUID), созданные до логина, остаются в БД,
-- но этому пользователю уже не видны — он начинает «с чистого листа»
-- под своим именем.
--
-- Применение:
--   wrangler d1 execute baza --remote --file=ai-kb/migrations/0007_users_auth.sql
-- Идемпотентна (CREATE TABLE IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE TABLE IF NOT EXISTS user_sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_exp  ON user_sessions (expires_at);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0007_users_auth');
