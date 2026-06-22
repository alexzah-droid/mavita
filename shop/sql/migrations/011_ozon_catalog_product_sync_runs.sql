-- Персистентная очередь синхронизации каталога товаров МАВИТА → Ozon. Массовая и
-- single-item синхронизация не выполняется внутри request lifecycle: endpoint
-- создаёт run, а worker/CLI подхватывает его по lease/fencing-модели. Worker
-- захватывает только просроченный или свободный lease и сверяет token при каждой
-- записи. Идемпотентна.
BEGIN;

CREATE TABLE IF NOT EXISTS ozon_catalog_product_sync_runs (
  id                 UUID PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('single','bulk')),
  operation          TEXT NOT NULL CHECK (operation IN ('content_import','stock_update','zero_stock','moderation_poll')),
  -- Снимок выбранного склада на момент создания run (BIGINT id Ozon).
  warehouse_id       BIGINT,
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  actor_login_at     BIGINT NOT NULL,
  total_items        INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  succeeded_items    INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_items >= 0),
  failed_items       INTEGER NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
  -- Безопасное резюме без секретов и персональных данных.
  summary            TEXT,
  -- Fencing: владелец run-а и срок аренды. Worker берёт только свободный/просроченный.
  lease_token        UUID,
  lease_expires_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ozon_sync_runs_status ON ozon_catalog_product_sync_runs (status, created_at);

CREATE TABLE IF NOT EXISTS ozon_catalog_product_sync_run_items (
  id                  BIGSERIAL PRIMARY KEY,
  run_id              UUID NOT NULL REFERENCES ozon_catalog_product_sync_runs(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Снимки для execution-time re-check: контент/профиль не должны измениться между
  -- выборкой и HTTP-вызовом.
  product_updated_at  TIMESTAMPTZ,
  profile_updated_at  TIMESTAMPTZ,
  desired_stock       INTEGER CHECK (desired_stock IS NULL OR desired_stock >= 0),
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','skipped')),
  attempts            INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code          TEXT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ozon_sync_run_item UNIQUE (run_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_ozon_sync_run_items_run ON ozon_catalog_product_sync_run_items (run_id, status);

COMMIT;
