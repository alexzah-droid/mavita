-- Общий (между инстансами) лимит попыток «Проверить связь» перевозчика.
-- Не process-local Map: за прокси/PM2 несколько воркеров. Идемпотентна.
BEGIN;

CREATE TABLE IF NOT EXISTS delivery_test_attempts (
  id             BIGSERIAL PRIMARY KEY,
  actor_login_at BIGINT NOT NULL,
  ip             TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_test_attempts_window
  ON delivery_test_attempts (actor_login_at, ip, created_at);

COMMIT;
