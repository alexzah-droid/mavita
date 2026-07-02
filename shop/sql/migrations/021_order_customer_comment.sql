-- Комментарий покупателя к заказу (например, текст открытки к подарку).
-- Валидация длины (≤500) — в lib/orders.ts; CHECK страхует от обхода API.
BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_comment TEXT
    CONSTRAINT orders_customer_comment_length CHECK (customer_comment IS NULL OR char_length(customer_comment) <= 500);

COMMIT;
