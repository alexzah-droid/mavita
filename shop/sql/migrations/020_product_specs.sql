-- Публичные характеристики свечи на карточке товара (все опциональные):
-- время горения (часы), состав воска, фитиль. Вес уже есть (weight_grams, 015) —
-- теперь он тоже показывается на витрине, а не только уходит в СДЭК.
BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS burn_time_hours SMALLINT
    CONSTRAINT products_burn_time_positive CHECK (burn_time_hours IS NULL OR burn_time_hours > 0),
  ADD COLUMN IF NOT EXISTS wax TEXT,
  ADD COLUMN IF NOT EXISTS wick TEXT;

COMMIT;
