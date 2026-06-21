-- Локальный каталог ПВЗ Ozon. У Ozon point/list отдаёт только id+координаты, а
-- город/адрес/название — отдельным point/info (батчами ≤100). Поэтому поиск ПВЗ по
-- городу строится по локальной копии, которую обновляет фоновая синхронизация
-- (scripts/sync-ozon-pickup-points.ts), а не живым запросом. Идемпотентна.
BEGIN;

CREATE TABLE IF NOT EXISTS ozon_pickup_points (
  map_point_id BIGINT PRIMARY KEY,
  city         TEXT NOT NULL,
  name         TEXT NOT NULL,
  address      TEXT NOT NULL,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Поиск по городу нечувствителен к регистру.
CREATE INDEX IF NOT EXISTS idx_ozon_pickup_points_city ON ozon_pickup_points (lower(city));

COMMIT;
