-- Миграция 017: URL штрихкода-наклейки СДЭК (дополнение к накладной)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cdek_barcode_url TEXT;
