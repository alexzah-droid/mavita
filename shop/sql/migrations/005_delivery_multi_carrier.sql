-- Мульти-перевозчик: разрешить второй перевозчик (Ozon) в заказах и завести
-- per-carrier тарифы/флаги в store_settings. Номер 004 занят Telegram.
-- Идемпотентна и безопасна для существующих заказов (как 003). Секреты ключей —
-- в следующей миграции 006_delivery_carrier_secrets.sql.
BEGIN;

-- ── orders: разрешить ('ozon_pickup','ozon') наравне с СДЭК ──────────────────
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_method_check CHECK (
  (delivery_method IS NULL AND delivery_carrier IS NULL AND delivery_kopecks = 0)
  OR (delivery_method = 'cdek_pickup' AND delivery_carrier = 'cdek')
  OR (delivery_method = 'ozon_pickup' AND delivery_carrier = 'ozon')
);

-- pickup_point_* обязателен для ЛЮБОГО ПВЗ-способа (a не только cdek_pickup).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_point_snapshot_check;
ALTER TABLE orders ADD CONSTRAINT orders_pickup_point_snapshot_check CHECK (
  delivery_method IS NULL OR (
    delivery_method LIKE '%\_pickup'
    AND pickup_point_code IS NOT NULL AND char_length(btrim(pickup_point_code)) > 0
    AND pickup_point_city IS NOT NULL AND char_length(btrim(pickup_point_city)) > 0
    AND pickup_point_name IS NOT NULL AND char_length(btrim(pickup_point_name)) > 0
    AND pickup_point_address IS NOT NULL AND char_length(btrim(pickup_point_address)) > 0
  )
);

-- ── store_settings: тариф и флаг на каждого перевозчика ──────────────────────
-- Снять старый NOT NULL с тарифа СДЭК: выключенный перевозчик может не иметь
-- тарифа. CHECK (>= 0) остаётся и продолжает запрещать отрицательные значения,
-- допуская NULL у выключенного carrier.
ALTER TABLE store_settings ALTER COLUMN cdek_pickup_delivery_kopecks DROP NOT NULL;

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS ozon_pickup_delivery_kopecks INTEGER,
  ADD COLUMN IF NOT EXISTS cdek_pickup_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ozon_pickup_enabled BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'store_settings'::regclass
                   AND conname = 'store_settings_ozon_delivery_nonnegative') THEN
    ALTER TABLE store_settings ADD CONSTRAINT store_settings_ozon_delivery_nonnegative
      CHECK (ozon_pickup_delivery_kopecks IS NULL OR ozon_pickup_delivery_kopecks >= 0);
  END IF;
END $$;

COMMIT;
