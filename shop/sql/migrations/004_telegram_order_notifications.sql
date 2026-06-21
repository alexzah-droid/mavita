-- Ф4: односторонние Telegram-уведомления о событиях заказов.
-- Применять после 003_orders_delivery_and_admin_events.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS telegram_notification_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true
    CONSTRAINT telegram_notification_settings_singleton_check CHECK (singleton),
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
  CONSTRAINT telegram_notification_settings_credentials_check CHECK (
    (bot_token_ciphertext IS NULL AND bot_token_iv IS NULL AND bot_token_auth_tag IS NULL AND token_last4 IS NULL)
    OR (bot_token_ciphertext IS NOT NULL AND bot_token_iv IS NOT NULL AND bot_token_auth_tag IS NOT NULL AND token_last4 IS NOT NULL AND char_length(token_last4) = 4)
  ),
  CONSTRAINT telegram_notification_settings_enabled_check CHECK (
    NOT enabled OR (chat_id IS NOT NULL AND char_length(btrim(chat_id)) BETWEEN 1 AND 32 AND bot_token_ciphertext IS NOT NULL)
  )
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
  CONSTRAINT order_notification_outbox_state_check CHECK (
    (status = 'sent' AND sent_at IS NOT NULL AND telegram_message_id IS NOT NULL)
    OR (status IN ('pending', 'sending', 'failed') AND sent_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_order_notification_outbox_ready
  ON order_notification_outbox (available_at, id) WHERE status = 'pending';

COMMIT;
