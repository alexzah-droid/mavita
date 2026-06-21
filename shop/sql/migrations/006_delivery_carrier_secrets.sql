-- Зашифрованные секреты перевозчиков в store_settings. Применять после 005.
-- Открытый ключ в БД не хранится: *_enc = AES-256-GCM, формат version|iv|tag|ciphertext
-- (см. lib/secret-box.ts). Мастер-ключ SETTINGS_ENC_KEY — только в .env.
--
-- Безопасный порядок: поля nullable, completeness-CHECK добавляется NOT VALID
-- (не проверяет существующие строки, где ключи пока в .env). VALIDATE CONSTRAINT —
-- отдельная операционная команда ПОСЛЕ заполнения ключей через UI/backfill.
-- Идемпотентна.
BEGIN;

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS cdek_client_id         TEXT,   -- несекретный id
  ADD COLUMN IF NOT EXISTS cdek_client_secret_enc BYTEA,  -- AES-GCM: version|iv|tag|ciphertext
  ADD COLUMN IF NOT EXISTS ozon_client_id         TEXT,
  ADD COLUMN IF NOT EXISTS ozon_api_key_enc       BYTEA;

-- enabled ⇒ заданы client_id + секрет + тариф. NOT VALID: существующая singleton-строка
-- (ключи в .env, флаги по умолчанию false из 005) не нарушает инвариант, а новые
-- INSERT/UPDATE — проверяются. После backfill выполнить VALIDATE CONSTRAINT (operations.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'store_settings'::regclass
                   AND conname = 'store_settings_cdek_complete_check') THEN
    ALTER TABLE store_settings ADD CONSTRAINT store_settings_cdek_complete_check CHECK (
      cdek_pickup_enabled = false
      OR (cdek_client_id IS NOT NULL AND cdek_client_secret_enc IS NOT NULL
          AND cdek_pickup_delivery_kopecks IS NOT NULL)
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'store_settings'::regclass
                   AND conname = 'store_settings_ozon_complete_check') THEN
    ALTER TABLE store_settings ADD CONSTRAINT store_settings_ozon_complete_check CHECK (
      ozon_pickup_enabled = false
      OR (ozon_client_id IS NOT NULL AND ozon_api_key_enc IS NOT NULL
          AND ozon_pickup_delivery_kopecks IS NOT NULL)
    ) NOT VALID;
  END IF;
END $$;

COMMIT;
