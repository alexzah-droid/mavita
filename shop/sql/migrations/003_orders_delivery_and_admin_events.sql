-- Ф4: доставка СДЭК, snapshot заказа и журнал действий администратора.
-- Идемпотентна и безопасна для уже существующих заказов.
BEGIN;

CREATE TABLE IF NOT EXISTS store_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CONSTRAINT store_settings_singleton_check CHECK (singleton),
  cdek_pickup_delivery_kopecks INTEGER NOT NULL CONSTRAINT store_settings_cdek_delivery_nonnegative CHECK (cdek_pickup_delivery_kopecks >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_actor_login_at BIGINT NOT NULL
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS items_kopecks INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_kopecks INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_method TEXT,
  ADD COLUMN IF NOT EXISTS delivery_carrier TEXT,
  ADD COLUMN IF NOT EXISTS pickup_point_code TEXT,
  ADD COLUMN IF NOT EXISTS pickup_point_city TEXT,
  ADD COLUMN IF NOT EXISTS pickup_point_name TEXT,
  ADD COLUMN IF NOT EXISTS pickup_point_address TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT;

-- Legacy-заказы не имеют доставки; их сумма остаётся snapshot товаров.
UPDATE orders
SET items_kopecks = total_kopecks,
    delivery_kopecks = 0,
    fulfillment_status = CASE status
      WHEN 'pending' THEN 'awaiting_payment'
      WHEN 'paid' THEN 'new'
      WHEN 'cancelled' THEN 'cancelled'
    END
WHERE items_kopecks IS NULL OR delivery_kopecks IS NULL OR fulfillment_status IS NULL;

ALTER TABLE orders ALTER COLUMN items_kopecks SET NOT NULL;
ALTER TABLE orders ALTER COLUMN delivery_kopecks SET NOT NULL;
ALTER TABLE orders ALTER COLUMN fulfillment_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_total_components_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_total_components_check CHECK (total_kopecks = items_kopecks + delivery_kopecks);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_delivery_method_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_delivery_method_check CHECK ((delivery_method IS NULL AND delivery_carrier IS NULL AND delivery_kopecks = 0) OR (delivery_method = 'cdek_pickup' AND delivery_carrier = 'cdek'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_pickup_point_snapshot_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_pickup_point_snapshot_check CHECK (delivery_method IS NULL OR (delivery_method = 'cdek_pickup' AND pickup_point_code IS NOT NULL AND char_length(btrim(pickup_point_code)) > 0 AND pickup_point_city IS NOT NULL AND char_length(btrim(pickup_point_city)) > 0 AND pickup_point_name IS NOT NULL AND char_length(btrim(pickup_point_name)) > 0 AND pickup_point_address IS NOT NULL AND char_length(btrim(pickup_point_address)) > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_fulfillment_status_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_status_check CHECK (fulfillment_status IN ('awaiting_payment', 'new', 'packing', 'handed_to_carrier', 'delivered', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_payment_fulfillment_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_payment_fulfillment_check CHECK ((status = 'pending' AND fulfillment_status = 'awaiting_payment') OR (status = 'paid' AND fulfillment_status IN ('new', 'packing', 'handed_to_carrier', 'delivered')) OR (status = 'cancelled' AND fulfillment_status = 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_tracking_number_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_tracking_number_check CHECK ((fulfillment_status IN ('handed_to_carrier', 'delivered') AND tracking_number IS NOT NULL AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64) OR (fulfillment_status NOT IN ('handed_to_carrier', 'delivered') AND tracking_number IS NULL));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS order_admin_events (
  id BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CONSTRAINT order_admin_events_type_check CHECK (event_type IN ('cancelled', 'fulfillment_transition')),
  reason TEXT,
  from_fulfillment_status TEXT,
  to_fulfillment_status TEXT,
  tracking_number TEXT,
  actor_login_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_admin_events_shape_check CHECK (
    (event_type = 'cancelled' AND reason IS NOT NULL AND char_length(btrim(reason)) BETWEEN 5 AND 500 AND from_fulfillment_status = 'awaiting_payment' AND to_fulfillment_status = 'cancelled' AND tracking_number IS NULL)
    OR
    (event_type = 'fulfillment_transition' AND reason IS NULL AND from_fulfillment_status IS NOT NULL AND to_fulfillment_status IS NOT NULL AND ((from_fulfillment_status = 'new' AND to_fulfillment_status = 'packing' AND tracking_number IS NULL) OR (from_fulfillment_status = 'packing' AND to_fulfillment_status = 'handed_to_carrier' AND tracking_number IS NOT NULL AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64) OR (from_fulfillment_status = 'handed_to_carrier' AND to_fulfillment_status = 'delivered' AND tracking_number IS NULL)))
  )
);
CREATE INDEX IF NOT EXISTS idx_orders_created_id_desc ON orders (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_admin_events_order_created ON order_admin_events (order_id, created_at DESC, id DESC);
COMMIT;
