-- Миграция 019: защита и производительность вебхука СДЭК.
-- 1) cdek_webhook_secret — случайный токен, который регистрация вебхука вшивает
--    в URL (?secret=…); /api/cdek/webhook принимает событие только с ним
--    (СДЭК не подписывает вебхуки HMAC, секрет в URL — единственная аутентификация).
-- 2) Частичный индекс по cdek_order_uuid: вебхук ищет заказ по UUID на каждое
--    событие — без индекса это seq scan всей таблицы orders.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS cdek_webhook_secret TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_cdek_order_uuid
    ON orders (cdek_order_uuid) WHERE cdek_order_uuid IS NOT NULL;
