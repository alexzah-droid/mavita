-- Полное удаление интеграции ОЗОН из БД (доставка ПВЗ + FBS-каталог).
-- Реверс миграций 008–012 и Ozon-частей 005/006. Применять после 012.
--
-- Контекст: Ozon не выдал API-ключи, интеграция снята с продукта. Ozon-заказы на
-- проде не создавались (order-flow был выключен), поэтому ужесточение
-- orders_delivery_method_check до cdek-only не нарушает существующие строки.
-- Всё через IF EXISTS / CASCADE — миграция идемпотентна и безопасна на стенде без Ozon.
BEGIN;

-- ── Триггеры и функции инвалидции профиля (на products/product_images) ────────
DROP TRIGGER IF EXISTS trg_ozon_profile_invalidate_product ON products;
DROP TRIGGER IF EXISTS trg_ozon_profile_invalidate_image ON product_images;
DROP FUNCTION IF EXISTS ozon_profile_invalidate_on_product_change();
DROP FUNCTION IF EXISTS ozon_profile_invalidate_on_image_change();
DROP FUNCTION IF EXISTS ozon_profile_invalidate(INTEGER);
DROP TRIGGER IF EXISTS trg_ozon_product_profiles_set_updated_at ON ozon_product_profiles;
DROP FUNCTION IF EXISTS ozon_product_profiles_set_updated_at();

-- ── Таблицы Ozon (CASCADE снимает FK-зависимости run_items → runs, profiles → products) ──
DROP TABLE IF EXISTS ozon_catalog_product_sync_run_items CASCADE;
DROP TABLE IF EXISTS ozon_catalog_product_sync_runs CASCADE;
DROP TABLE IF EXISTS ozon_product_profiles CASCADE;
DROP TABLE IF EXISTS ozon_catalog_sync CASCADE;
DROP TABLE IF EXISTS ozon_pickup_points CASCADE;

-- ── store_settings: убрать колонки и CHECK-и Ozon (DROP COLUMN снимает и колоночные CHECK) ──
ALTER TABLE store_settings DROP CONSTRAINT IF EXISTS store_settings_ozon_complete_check;
ALTER TABLE store_settings
  DROP COLUMN IF EXISTS ozon_pickup_enabled,
  DROP COLUMN IF EXISTS ozon_pickup_delivery_kopecks,
  DROP COLUMN IF EXISTS ozon_client_id,
  DROP COLUMN IF EXISTS ozon_api_key_enc,
  DROP COLUMN IF EXISTS ozon_fbs_warehouse_id,
  DROP COLUMN IF EXISTS ozon_fbs_warehouse_name;

-- ── orders: ужесточить разрешённые способы доставки до СДЭК-only ──────────────
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_method_check CHECK (
  (delivery_method IS NULL AND delivery_carrier IS NULL AND delivery_kopecks = 0)
  OR (delivery_method = 'cdek_pickup' AND delivery_carrier = 'cdek')
);

COMMIT;
