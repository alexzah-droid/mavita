-- МАВИТА-ШОП — схема БД (PostgreSQL 16)
-- Применяется один раз при развёртывании:  psql -U postgres -d mavita -f sql/schema.sql
--
-- Инвариант I2: цены хранятся в КОПЕЙКАХ как INTEGER. FLOAT для цен запрещён.

-- ─────────────────────────────────────────────────────────────
-- Товары
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id            SERIAL PRIMARY KEY,
    slug          TEXT UNIQUE NOT NULL,          -- для URL: /product/<slug>
    name          TEXT NOT NULL,
    series        TEXT,                          -- «Горы · …»
    subtitle      TEXT,                          -- короткое название серии
    description   TEXT,
    price_kopecks INTEGER NOT NULL CHECK (price_kopecks >= 0),  -- I2: копейки, не float
    scent         TEXT[] NOT NULL DEFAULT '{}',  -- ароматы (теги)
    in_stock      BOOLEAN NOT NULL DEFAULT true,
    visibility    TEXT NOT NULL DEFAULT 'public' CONSTRAINT products_visibility_check CHECK (visibility IN ('public', 'unlisted', 'hidden')),
    sale_price_kopecks INTEGER CONSTRAINT products_sale_price_nonnegative CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks >= 0),
    sale_starts_at TIMESTAMPTZ,
    sale_ends_at   TIMESTAMPTZ,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT products_sale_below_price CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks < price_kopecks),
    CONSTRAINT products_sale_window CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at)
);

CREATE INDEX IF NOT EXISTS idx_products_sort ON products (sort_order, id);
CREATE INDEX IF NOT EXISTS idx_products_public_sort ON products (sort_order, id) WHERE visibility = 'public';

CREATE OR REPLACE FUNCTION products_set_updated_at()
RETURNS TRIGGER AS $$ BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_products_set_updated_at ON products;
CREATE TRIGGER trg_products_set_updated_at BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION products_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Фотографии товара (одна карточка — несколько фото)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
    id          SERIAL PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,                   -- путь/имя в /public/uploads/products/
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_cover    BOOLEAN NOT NULL DEFAULT false   -- главное фото для витрины
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id, sort_order);
-- Не более одной обложки на товар.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_cover
    ON product_images (product_id) WHERE is_cover;

-- ─────────────────────────────────────────────────────────────
-- Заказы
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id             SERIAL PRIMARY KEY,
    token          TEXT UNIQUE NOT NULL,         -- неугадываемый идентификатор для URL /order/<token>
    inv_id         INTEGER UNIQUE,               -- InvId для Робокассы (= id)
    customer_name  TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    total_kopecks  INTEGER NOT NULL CHECK (total_kopecks >= 0),  -- I2
    items_kopecks  INTEGER NOT NULL CHECK (items_kopecks >= 0),
    delivery_kopecks INTEGER NOT NULL CHECK (delivery_kopecks >= 0),
    delivery_method TEXT,
    delivery_carrier TEXT,
    pickup_point_code TEXT,
    pickup_point_city TEXT,
    pickup_point_name TEXT,
    pickup_point_address TEXT,
    fulfillment_status TEXT NOT NULL DEFAULT 'awaiting_payment',
    tracking_number TEXT,
    status         TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled')),
    robokassa_data JSONB,                         -- сырой ответ Робокассы
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT orders_total_components_check CHECK (total_kopecks = items_kopecks + delivery_kopecks),
    CONSTRAINT orders_delivery_method_check CHECK ((delivery_method IS NULL AND delivery_carrier IS NULL AND delivery_kopecks = 0) OR (delivery_method = 'cdek_pickup' AND delivery_carrier = 'cdek') OR (delivery_method = 'ozon_pickup' AND delivery_carrier = 'ozon')),
    CONSTRAINT orders_pickup_point_snapshot_check CHECK (delivery_method IS NULL OR (delivery_method LIKE '%\_pickup' AND pickup_point_code IS NOT NULL AND char_length(btrim(pickup_point_code)) > 0 AND pickup_point_city IS NOT NULL AND char_length(btrim(pickup_point_city)) > 0 AND pickup_point_name IS NOT NULL AND char_length(btrim(pickup_point_name)) > 0 AND pickup_point_address IS NOT NULL AND char_length(btrim(pickup_point_address)) > 0)),
    CONSTRAINT orders_fulfillment_status_check CHECK (fulfillment_status IN ('awaiting_payment', 'new', 'packing', 'handed_to_carrier', 'delivered', 'cancelled')),
    CONSTRAINT orders_payment_fulfillment_check CHECK ((status = 'pending' AND fulfillment_status = 'awaiting_payment') OR (status = 'paid' AND fulfillment_status IN ('new', 'packing', 'handed_to_carrier', 'delivered')) OR (status = 'cancelled' AND fulfillment_status = 'cancelled')),
    CONSTRAINT orders_tracking_number_check CHECK ((fulfillment_status IN ('handed_to_carrier', 'delivered') AND tracking_number IS NOT NULL AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64) OR (fulfillment_status NOT IN ('handed_to_carrier', 'delivered') AND tracking_number IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_id_desc ON orders (created_at DESC, id DESC);

-- Мульти-перевозчик доставки. Тарифы nullable (выключенный перевозчик может не
-- иметь тарифа); секреты ключей хранятся ШИФРОВАННЫМИ (*_enc, AES-256-GCM,
-- формат version|iv|tag|ciphertext; см. lib/secret-box.ts). Открытый ключ в БД
-- не хранится. enabled ⇒ заданы client_id + секрет + тариф.
CREATE TABLE IF NOT EXISTS store_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CONSTRAINT store_settings_singleton_check CHECK (singleton),
    cdek_pickup_enabled BOOLEAN NOT NULL DEFAULT false,
    cdek_pickup_delivery_kopecks INTEGER CONSTRAINT store_settings_cdek_delivery_nonnegative CHECK (cdek_pickup_delivery_kopecks IS NULL OR cdek_pickup_delivery_kopecks >= 0),
    cdek_client_id TEXT,
    cdek_client_secret_enc BYTEA,
    ozon_pickup_enabled BOOLEAN NOT NULL DEFAULT false,
    ozon_pickup_delivery_kopecks INTEGER CONSTRAINT store_settings_ozon_delivery_nonnegative CHECK (ozon_pickup_delivery_kopecks IS NULL OR ozon_pickup_delivery_kopecks >= 0),
    ozon_client_id TEXT,
    ozon_api_key_enc BYTEA,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_actor_login_at BIGINT NOT NULL,
    CONSTRAINT store_settings_cdek_complete_check CHECK (cdek_pickup_enabled = false OR (cdek_client_id IS NOT NULL AND cdek_client_secret_enc IS NOT NULL AND cdek_pickup_delivery_kopecks IS NOT NULL)),
    CONSTRAINT store_settings_ozon_complete_check CHECK (ozon_pickup_enabled = false OR (ozon_client_id IS NOT NULL AND ozon_api_key_enc IS NOT NULL AND ozon_pickup_delivery_kopecks IS NOT NULL))
);

-- Локальный каталог ПВЗ Ozon (point/list даёт только id+координаты; детали —
-- через point/info батчами). Поиск по городу идёт по этой копии; обновляет её
-- фоновая синхронизация (scripts/sync-ozon-pickup-points.ts).
CREATE TABLE IF NOT EXISTS ozon_pickup_points (
    map_point_id BIGINT PRIMARY KEY,
    city         TEXT NOT NULL,
    name         TEXT NOT NULL,
    address      TEXT NOT NULL,
    lat          DOUBLE PRECISION,
    lng          DOUBLE PRECISION,
    last_seen_run_id UUID,                 -- метка последнего полного прохода синхронизации
    missed_runs  INTEGER NOT NULL DEFAULT 0, -- сколько полных проходов подряд id отсутствовал
    active       BOOLEAN NOT NULL DEFAULT true, -- скрытие вместо удаления (обратимо)
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Поиск отдаёт только активные точки; индекс частичный.
CREATE INDEX IF NOT EXISTS idx_ozon_pickup_points_city ON ozon_pickup_points (lower(city)) WHERE active;

-- Состояние синхронизации каталога Ozon. Ozon включается только при свежей
-- успешной полной синхронизации; resolveDeliveryMode() это проверяет.
CREATE TABLE IF NOT EXISTS ozon_catalog_sync (
    singleton          BOOLEAN PRIMARY KEY DEFAULT true CONSTRAINT ozon_catalog_sync_singleton_check CHECK (singleton),
    run_id             UUID,
    status             TEXT NOT NULL DEFAULT 'idle' CONSTRAINT ozon_catalog_sync_status_check CHECK (status IN ('idle','running','success','failed')),
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    expected_ids       INTEGER,
    processed_ids      INTEGER NOT NULL DEFAULT 0,
    last_error         TEXT,
    last_success_at    TIMESTAMPTZ,        -- источник истины для свежести
    last_success_count INTEGER NOT NULL DEFAULT 0
);

-- Общий лимит попыток «Проверить связь» перевозчика (5 / 10 мин на actor+IP).
CREATE TABLE IF NOT EXISTS delivery_test_attempts (
    id             BIGSERIAL PRIMARY KEY,
    actor_login_at BIGINT NOT NULL,
    ip             TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_test_attempts_window ON delivery_test_attempts (actor_login_at, ip, created_at);

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
    CONSTRAINT order_admin_events_shape_check CHECK ((event_type = 'cancelled' AND reason IS NOT NULL AND char_length(btrim(reason)) BETWEEN 5 AND 500 AND from_fulfillment_status = 'awaiting_payment' AND to_fulfillment_status = 'cancelled' AND tracking_number IS NULL) OR (event_type = 'fulfillment_transition' AND reason IS NULL AND from_fulfillment_status IS NOT NULL AND to_fulfillment_status IS NOT NULL AND ((from_fulfillment_status = 'new' AND to_fulfillment_status = 'packing' AND tracking_number IS NULL) OR (from_fulfillment_status = 'packing' AND to_fulfillment_status = 'handed_to_carrier' AND tracking_number IS NOT NULL AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64) OR (from_fulfillment_status = 'handed_to_carrier' AND to_fulfillment_status = 'delivered' AND tracking_number IS NULL))))
);
CREATE INDEX IF NOT EXISTS idx_order_admin_events_order_created ON order_admin_events (order_id, created_at DESC, id DESC);

-- ─────────────────────────────────────────────────────────────
-- Telegram-уведомления (токен хранится только зашифрованным)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_notification_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CONSTRAINT telegram_notification_settings_singleton_check CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT false,
    chat_id TEXT,
    bot_token_ciphertext BYTEA,
    bot_token_iv BYTEA,
    bot_token_auth_tag BYTEA,
    token_last4 TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_actor_login_at BIGINT NOT NULL,
    last_delivery_error TEXT,
    last_delivery_error_at TIMESTAMPTZ,
    CONSTRAINT telegram_notification_settings_credentials_check CHECK ((bot_token_ciphertext IS NULL AND bot_token_iv IS NULL AND bot_token_auth_tag IS NULL AND token_last4 IS NULL) OR (bot_token_ciphertext IS NOT NULL AND bot_token_iv IS NOT NULL AND bot_token_auth_tag IS NOT NULL AND token_last4 IS NOT NULL AND char_length(token_last4) = 4)),
    CONSTRAINT telegram_notification_settings_enabled_check CHECK (NOT enabled OR (chat_id IS NOT NULL AND char_length(btrim(chat_id)) BETWEEN 1 AND 32 AND bot_token_ciphertext IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS order_notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    event_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL CHECK (event_type IN ('order_created', 'payment_paid', 'order_cancelled', 'fulfillment_changed')),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    locked_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    telegram_message_id BIGINT,
    last_error TEXT,
    CONSTRAINT order_notification_outbox_state_check CHECK ((status = 'sent' AND sent_at IS NOT NULL AND telegram_message_id IS NOT NULL) OR (status IN ('pending', 'sending', 'failed') AND sent_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_order_notification_outbox_ready ON order_notification_outbox (available_at, id) WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────
-- Состав заказа — snapshot названия и цены на момент покупки
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
    id            SERIAL PRIMARY KEY,
    order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name  TEXT NOT NULL,                 -- snapshot
    price_kopecks INTEGER NOT NULL CHECK (price_kopecks >= 0),   -- snapshot, I2
    quantity      INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
