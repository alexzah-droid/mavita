-- СДЭК: поля отправления в заказах
ALTER TABLE orders
  ADD COLUMN cdek_order_uuid  TEXT,
  ADD COLUMN cdek_number      TEXT,
  ADD COLUMN cdek_waybill_url TEXT,
  ADD COLUMN cdek_error       TEXT;

-- СДЭК: настройки автоотправки в store_settings
ALTER TABLE store_settings
  ADD COLUMN cdek_auto_shipment_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN cdek_shipment_point        TEXT,
  ADD COLUMN cdek_sender_name           TEXT,
  ADD COLUMN cdek_sender_phone          TEXT,
  ADD COLUMN cdek_default_weight_grams  INTEGER DEFAULT 500
    CONSTRAINT store_settings_cdek_weight_positive
      CHECK (cdek_default_weight_grams IS NULL OR cdek_default_weight_grams > 0),
  ADD COLUMN cdek_default_length_cm     SMALLINT DEFAULT 11
    CONSTRAINT store_settings_cdek_length_positive
      CHECK (cdek_default_length_cm IS NULL OR cdek_default_length_cm > 0),
  ADD COLUMN cdek_default_width_cm      SMALLINT DEFAULT 11
    CONSTRAINT store_settings_cdek_width_positive
      CHECK (cdek_default_width_cm IS NULL OR cdek_default_width_cm > 0),
  ADD COLUMN cdek_default_height_cm     SMALLINT DEFAULT 11
    CONSTRAINT store_settings_cdek_height_positive
      CHECK (cdek_default_height_cm IS NULL OR cdek_default_height_cm > 0),
  ADD COLUMN cdek_multi_length_cm       SMALLINT DEFAULT 30
    CONSTRAINT store_settings_cdek_multi_length_positive
      CHECK (cdek_multi_length_cm IS NULL OR cdek_multi_length_cm > 0),
  ADD COLUMN cdek_multi_width_cm        SMALLINT DEFAULT 20
    CONSTRAINT store_settings_cdek_multi_width_positive
      CHECK (cdek_multi_width_cm IS NULL OR cdek_multi_width_cm > 0),
  ADD COLUMN cdek_multi_height_cm       SMALLINT DEFAULT 15
    CONSTRAINT store_settings_cdek_multi_height_positive
      CHECK (cdek_multi_height_cm IS NULL OR cdek_multi_height_cm > 0),
  ADD COLUMN cdek_webhook_uuid          TEXT;

-- Нельзя включить автоотправку без точки сдачи и данных отправителя
ALTER TABLE store_settings
  ADD CONSTRAINT store_settings_cdek_auto_shipment_complete_check
    CHECK (cdek_auto_shipment_enabled = false OR (
      cdek_shipment_point IS NOT NULL AND char_length(btrim(cdek_shipment_point)) > 0 AND
      cdek_sender_name    IS NOT NULL AND char_length(btrim(cdek_sender_name))    > 0 AND
      cdek_sender_phone   IS NOT NULL AND char_length(btrim(cdek_sender_phone))   > 0
    ));

-- Расширить допустимые типы событий в журнале заказов
ALTER TABLE order_admin_events DROP CONSTRAINT order_admin_events_type_check;
ALTER TABLE order_admin_events
  ADD CONSTRAINT order_admin_events_type_check
    CHECK (event_type IN ('cancelled', 'fulfillment_transition', 'cdek_status_update'));

ALTER TABLE order_admin_events DROP CONSTRAINT order_admin_events_shape_check;
ALTER TABLE order_admin_events
  ADD CONSTRAINT order_admin_events_shape_check CHECK (
    (event_type = 'cancelled'
      AND reason IS NOT NULL AND char_length(btrim(reason)) BETWEEN 5 AND 500
      AND from_fulfillment_status = 'awaiting_payment'
      AND to_fulfillment_status = 'cancelled'
      AND tracking_number IS NULL)
    OR (event_type = 'fulfillment_transition'
      AND reason IS NULL
      AND from_fulfillment_status IS NOT NULL AND to_fulfillment_status IS NOT NULL
      AND ((from_fulfillment_status = 'new'              AND to_fulfillment_status = 'packing'          AND tracking_number IS NULL)
        OR (from_fulfillment_status = 'packing'          AND to_fulfillment_status = 'handed_to_carrier' AND tracking_number IS NOT NULL AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64)
        OR (from_fulfillment_status = 'handed_to_carrier' AND to_fulfillment_status = 'delivered'        AND tracking_number IS NULL)))
    OR (event_type = 'cdek_status_update'
      AND reason IS NULL
      AND from_fulfillment_status IS NOT NULL AND to_fulfillment_status IS NOT NULL)
  );

-- Outbox для фоновых задач СДЭК (создание отправления + получение накладной)
CREATE TABLE cdek_task_outbox (
    id            BIGSERIAL PRIMARY KEY,
    order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    task_type     TEXT NOT NULL
      CONSTRAINT cdek_task_outbox_task_type_check
        CHECK (task_type IN ('create_shipment', 'poll_waybill')),
    event_key     TEXT NOT NULL UNIQUE,
    payload       JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count INTEGER NOT NULL DEFAULT 0
      CONSTRAINT cdek_task_outbox_attempts_nonneg CHECK (attempt_count >= 0),
    status        TEXT NOT NULL DEFAULT 'pending'
      CONSTRAINT cdek_task_outbox_status_check
        CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    locked_at     TIMESTAMPTZ,
    done_at       TIMESTAMPTZ,
    last_error    TEXT,
    CONSTRAINT cdek_task_outbox_state_check
      CHECK ((status = 'done'     AND done_at IS NOT NULL)
          OR (status IN ('pending', 'processing', 'failed') AND done_at IS NULL))
);
CREATE INDEX idx_cdek_task_outbox_ready ON cdek_task_outbox (available_at, id)
  WHERE status = 'pending';
