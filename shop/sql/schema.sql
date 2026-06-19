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
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_sort ON products (sort_order, id);

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
    inv_id         INTEGER UNIQUE,               -- InvId для Робокассы
    customer_name  TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    total_kopecks  INTEGER NOT NULL CHECK (total_kopecks >= 0),  -- I2
    status         TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled')),
    robokassa_data JSONB,                         -- сырой ответ Робокассы
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC);

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
