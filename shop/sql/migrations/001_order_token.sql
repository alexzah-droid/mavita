-- Миграция 001 — orders.token (фикс IDOR, TD-1)
-- Контекст: прод-БД развёрнута 2026-06-20 со старой схемой orders (без token),
-- там уже есть заказы (тестовый платёж). schema.sql теперь содержит token для
-- СВЕЖИХ установок; этой таблице нужен ALTER + бэкофилл существующих строк.
--
-- Применить на проде ОДИН РАЗ перед деплоем кода с маршрутом /order/<token>:
--   psql -U mavita -d mavita -f sql/migrations/001_order_token.sql
-- Идемпотентна: повторный запуск безопасен.

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS token TEXT;

-- Бэкофилл существующих заказов. gen_random_uuid() — в ядре PostgreSQL ≥ 13.
UPDATE orders SET token = gen_random_uuid()::text WHERE token IS NULL;

ALTER TABLE orders ALTER COLUMN token SET NOT NULL;

-- Уникальность token (только если ещё не создана).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_token_key') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_token_key UNIQUE (token);
  END IF;
END $$;

COMMIT;
