-- Ф4: видимость товара, временные скидки и updated_at.
-- Идемпотентна: psql -U mavita -d mavita -f sql/migrations/002_admin_visibility_discount.sql
BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS visibility TEXT,
  ADD COLUMN IF NOT EXISTS sale_price_kopecks INTEGER,
  ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sale_ends_at TIMESTAMPTZ;
UPDATE products SET visibility = 'public' WHERE visibility IS NULL;
ALTER TABLE products ALTER COLUMN visibility SET DEFAULT 'public';
ALTER TABLE products ALTER COLUMN visibility SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'products'::regclass AND conname = 'products_visibility_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_visibility_check CHECK (visibility IN ('public', 'unlisted', 'hidden'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'products'::regclass AND conname = 'products_sale_price_nonnegative') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_price_nonnegative CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'products'::regclass AND conname = 'products_sale_below_price') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_below_price CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks < price_kopecks);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'products'::regclass AND conname = 'products_sale_window') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_window CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_public_sort ON products (sort_order, id) WHERE visibility = 'public';
CREATE OR REPLACE FUNCTION products_set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_products_set_updated_at ON products;
CREATE TRIGGER trg_products_set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION products_set_updated_at();
COMMIT;
