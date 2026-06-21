-- Жизненный цикл синхронизации каталога ПВЗ Ozon: singleton-состояние (для гейта
-- «Ozon включается только при свежей успешной полной синхронизации») и run_id на
-- строках каталога (для удаления исчезнувших точек после полного прохода). Идемпотентна.
BEGIN;

CREATE TABLE IF NOT EXISTS ozon_catalog_sync (
  singleton          BOOLEAN PRIMARY KEY DEFAULT true CONSTRAINT ozon_catalog_sync_singleton_check CHECK (singleton),
  run_id             UUID,          -- текущий/последний запуск
  status             TEXT NOT NULL DEFAULT 'idle' CONSTRAINT ozon_catalog_sync_status_check CHECK (status IN ('idle','running','success','failed')),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  expected_ids       INTEGER,
  processed_ids      INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  -- Свежесть считается по ПОСЛЕДНЕМУ УСПЕШНОМУ проходу, а не по текущему статусу:
  -- идущая/упавшая синхронизация не обесценивает ещё свежий прошлый каталог.
  last_success_at    TIMESTAMPTZ,
  last_success_count INTEGER NOT NULL DEFAULT 0
);

-- Метка прохода + счётчик пропусков + флаг активности. Синхронизация НЕ удаляет
-- точки: отсутствующие ≥2 проходов подряд лишь СКРЫВАЮТСЯ (active=false) — это
-- обратимо (вернётся в список → снова active) и исключает потерю данных при
-- усечённом/битом point/list. Поиск отдаёт только active.
ALTER TABLE ozon_pickup_points ADD COLUMN IF NOT EXISTS last_seen_run_id UUID;
ALTER TABLE ozon_pickup_points ADD COLUMN IF NOT EXISTS missed_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ozon_pickup_points ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
-- Частичный индекс под поиск только активных точек.
DROP INDEX IF EXISTS idx_ozon_pickup_points_city;
CREATE INDEX IF NOT EXISTS idx_ozon_pickup_points_city ON ozon_pickup_points (lower(city)) WHERE active;

COMMIT;
