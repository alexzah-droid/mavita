-- Любое изменение ИМПОРТИРУЕМОГО контента товара должно сбрасывать подтверждение
-- ручного скрытия и dirty-флаги Ozon-профиля — иначе ранее подтверждённый ненулевой
-- FBS-остаток остался бы активным на устаревшей карточке. Раньше сброс был только в
-- PATCH самого профиля; правка названия/описания/цены/акции товара и upload/reorder/
-- delete фото проходили мимо. Делаем это триггерами на products и product_images,
-- чтобы покрыть ВСЕ пути записи. Видимость товара на сайте НЕ входит в импортируемый
-- контент (в payload Ozon не уходит) и намеренно не сбрасывает подтверждение.
-- Идемпотентна.
BEGIN;

CREATE OR REPLACE FUNCTION ozon_profile_invalidate(pid INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE ozon_product_profiles SET
    content_dirty = true,
    stock_dirty = true,
    manual_hidden_confirmed_at = NULL,
    manual_hidden_confirmed_by_login_at = NULL,
    hidden_verified_at = NULL,
    hidden_verification_method = NULL
  WHERE product_id = pid
    AND (content_dirty = false OR stock_dirty = false OR manual_hidden_confirmed_at IS NOT NULL OR hidden_verified_at IS NOT NULL);
END; $$ LANGUAGE plpgsql;

-- products: только импортируемые колонки (имя/описание/цена/акция).
CREATE OR REPLACE FUNCTION ozon_profile_invalidate_on_product_change()
RETURNS TRIGGER AS $$ BEGIN
  PERFORM ozon_profile_invalidate(NEW.id);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ozon_profile_invalidate_product ON products;
CREATE TRIGGER trg_ozon_profile_invalidate_product
AFTER UPDATE OF name, description, price_kopecks, sale_price_kopecks, sale_starts_at, sale_ends_at ON products
FOR EACH ROW WHEN (
  OLD.name IS DISTINCT FROM NEW.name OR
  OLD.description IS DISTINCT FROM NEW.description OR
  OLD.price_kopecks IS DISTINCT FROM NEW.price_kopecks OR
  OLD.sale_price_kopecks IS DISTINCT FROM NEW.sale_price_kopecks OR
  OLD.sale_starts_at IS DISTINCT FROM NEW.sale_starts_at OR
  OLD.sale_ends_at IS DISTINCT FROM NEW.sale_ends_at
)
EXECUTE FUNCTION ozon_profile_invalidate_on_product_change();

-- product_images: любой upload/reorder/delete меняет набор/порядок изображений.
CREATE OR REPLACE FUNCTION ozon_profile_invalidate_on_image_change()
RETURNS TRIGGER AS $$ BEGIN
  PERFORM ozon_profile_invalidate(COALESCE(NEW.product_id, OLD.product_id));
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ozon_profile_invalidate_image ON product_images;
CREATE TRIGGER trg_ozon_profile_invalidate_image
AFTER INSERT OR UPDATE OR DELETE ON product_images
FOR EACH ROW EXECUTE FUNCTION ozon_profile_invalidate_on_image_change();

COMMIT;
