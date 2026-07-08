-- Вес чистого воска на карточке товара. TEXT нужен для составных изделий:
-- у «Каменной пирамиды» верхняя и нижняя свечи имеют разный вес.
BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS wax_weight TEXT;

UPDATE products
SET wax_weight = CASE slug
  WHEN 'kamennaya-piramida' THEN 'верхняя часть — 25 г, нижняя часть — 85 г'
  WHEN 'simfoniya-kamney-1-cilindr' THEN '120 г'
  WHEN 'simfoniya-kamney-2-kub' THEN '90 г'
  WHEN 'simfoniya-kamney-3-cilindr' THEN '120 г'
END
WHERE slug IN (
  'kamennaya-piramida',
  'simfoniya-kamney-1-cilindr',
  'simfoniya-kamney-2-kub',
  'simfoniya-kamney-3-cilindr'
)
  AND wax_weight IS NULL;

COMMIT;
