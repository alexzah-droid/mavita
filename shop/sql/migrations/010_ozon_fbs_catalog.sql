-- Технический FBS-каталог Ozon: профиль синхронизации одной карточки товара
-- (МАВИТА → Ozon) + выбор существующего FBS-склада в store_settings. Источник
-- правды — БД МАВИТА; Ozon получает только явно разрешённые данные. Приложение
-- НЕ управляет видимостью карточки (visibility/set залочен программой «Ozon
-- Логистика и Select») — скрытие выполняет оператор вручную в ЛК, а приложение
-- держит FBS-остаток 0 до аудируемого подтверждения скрытия. Идемпотентна.
BEGIN;

CREATE TABLE IF NOT EXISTS ozon_product_profiles (
  product_id              INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  enabled                 BOOLEAN NOT NULL DEFAULT false,
  -- offer_id неизменяем: 'mavita-<product_id>'. Смена slug НЕ создаёт новую карточку.
  offer_id                TEXT NOT NULL UNIQUE,
  -- Лимит ИСКЛЮЧИТЕЛЬНО для выбранного FBS-склада Ozon. Не трогает products.in_stock,
  -- витрину и checkout сайта.
  fbs_stock_quantity      INTEGER NOT NULL DEFAULT 0
                            CHECK (fbs_stock_quantity >= 0),
  -- Обязательная пара leaf-типа из /v1/description-category/tree.
  description_category_id BIGINT,
  type_id                 BIGINT,
  barcode                 TEXT,
  weight_grams            INTEGER,
  length_mm               INTEGER,
  width_mm                INTEGER,
  height_mm               INTEGER,
  attributes_json         JSONB NOT NULL DEFAULT '[]'::jsonb,
  ozon_product_id         BIGINT,
  import_task_id          TEXT,
  remote_state            TEXT NOT NULL DEFAULT 'not_synced'
                           CHECK (remote_state IN ('not_synced','pending','awaiting_moderation','awaiting_manual_hide','hidden_confirmed','invalid','failed','disabled')),
  content_synced_at       TIMESTAMPTZ,
  stock_synced_at         TIMESTAMPTZ,
  moderation_started_at   TIMESTAMPTZ,
  last_moderation_checked_at TIMESTAMPTZ,
  moderation_status       TEXT,
  -- Аудит ручного скрытия в ЛК. *_by_login_at — login timestamp оператора (BIGINT).
  manual_hidden_confirmed_at TIMESTAMPTZ,
  manual_hidden_confirmed_by_login_at BIGINT,
  -- Признак скрытия, проверенный непосредственно перед ненулевым stock (или honor-system).
  hidden_verified_at      TIMESTAMPTZ,
  hidden_verification_method TEXT
                           CHECK (hidden_verification_method IN ('api','operator')),
  content_dirty           BOOLEAN NOT NULL DEFAULT true,
  stock_dirty             BOOLEAN NOT NULL DEFAULT true,
  -- Последнее значение, ПРИНЯТОЕ Ozon, а не источник правды склада.
  last_stock_sent_quantity INTEGER NOT NULL DEFAULT 0
                           CHECK (last_stock_sent_quantity >= 0),
  -- Оператор подтвердил требования модерации категории (сертификат/декларация в ЛК).
  -- not_checked и blocked одинаково блокируют import.
  compliance_status       TEXT NOT NULL DEFAULT 'not_checked'
                           CHECK (compliance_status IN ('not_checked','ready','blocked')),
  compliance_note         TEXT,
  last_error_code         TEXT,
  last_error_message      TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ozon_profile_dimensions_positive CHECK (
    (weight_grams IS NULL OR weight_grams > 0) AND
    (length_mm IS NULL OR length_mm > 0) AND
    (width_mm IS NULL OR width_mm > 0) AND
    (height_mm IS NULL OR height_mm > 0)
  ),
  CONSTRAINT ozon_profile_category_pair CHECK (
    (description_category_id IS NULL) = (type_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ozon_product_profiles_state ON ozon_product_profiles (enabled, remote_state);
CREATE INDEX IF NOT EXISTS idx_ozon_product_profiles_ozon_id ON ozon_product_profiles (ozon_product_id);
-- Штрихкод уникален среди заполненных (Ozon не допускает дублей barcode).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ozon_product_profiles_barcode ON ozon_product_profiles (barcode) WHERE barcode IS NOT NULL;

-- updated_at trigger, аналогичный products_set_updated_at.
CREATE OR REPLACE FUNCTION ozon_product_profiles_set_updated_at()
RETURNS TRIGGER AS $$ BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ozon_product_profiles_set_updated_at ON ozon_product_profiles;
CREATE TRIGGER trg_ozon_product_profiles_set_updated_at BEFORE UPDATE ON ozon_product_profiles
FOR EACH ROW EXECUTE FUNCTION ozon_product_profiles_set_updated_at();

-- Выбранный существующий FBS-склад Ozon (создаётся в ЛК, не приложением).
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS ozon_fbs_warehouse_id BIGINT,
  ADD COLUMN IF NOT EXISTS ozon_fbs_warehouse_name TEXT;

COMMIT;
