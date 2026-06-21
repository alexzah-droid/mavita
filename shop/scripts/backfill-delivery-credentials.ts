// Разовый backfill ключей перевозчиков из .env в зашифрованные настройки БД.
// Запуск (старый runtime ещё обслуживает витрину):
//   SETTINGS_ENC_KEY=... CDEK_CLIENT_ID=... CDEK_CLIENT_SECRET=... \
//   DATABASE_URL=... npx tsx scripts/backfill-delivery-credentials.ts
//
// Берёт ключи ТОЛЬКО из process.env, шифрует, пишет singleton под FOR UPDATE,
// включает перевозчика с УЖЕ заданным тарифом и проверяет расшифровку. Значения
// секретов НЕ печатает. Падает, если тариф/ключи отсутствуют. Пишет напрямую через
// db + secret-box-core (не через server-only store-settings), чтобы работать под tsx.
import { withTransaction } from '@/lib/db'
import { assertSettingsEncKey, decryptSecret, encryptSecret } from '@/lib/secret-box-core'

const CARRIERS = {
  cdek: { enabledCol: 'cdek_pickup_enabled', tariffCol: 'cdek_pickup_delivery_kopecks', idCol: 'cdek_client_id', encCol: 'cdek_client_secret_enc', aad: 'cdek:client_secret', id: process.env.CDEK_CLIENT_ID, secret: process.env.CDEK_CLIENT_SECRET },
  ozon: { enabledCol: 'ozon_pickup_enabled', tariffCol: 'ozon_pickup_delivery_kopecks', idCol: 'ozon_client_id', encCol: 'ozon_api_key_enc', aad: 'ozon:api_key', id: process.env.OZON_CLIENT_ID, secret: process.env.OZON_API_KEY },
} as const

async function backfill(name: keyof typeof CARRIERS) {
  const c = CARRIERS[name]
  if (!c.id?.trim() || !c.secret?.trim()) { console.log(`· ${name}: ключи в env не заданы — пропуск`); return }
  const secret = c.secret.trim()
  const enc = encryptSecret(secret, c.aad)
  await withTransaction(async (client) => {
    const row = (await client.query<Record<string, unknown>>(`SELECT ${c.tariffCol} FROM store_settings WHERE singleton = true FOR UPDATE`)).rows[0]
    if (!row) throw new Error(`${name}: нет singleton store_settings — сначала задайте тариф в админке`)
    if (row[c.tariffCol] == null) throw new Error(`${name}: тариф (${c.tariffCol}) не задан — задайте в админке перед backfill`)
    await client.query(`UPDATE store_settings SET ${c.enabledCol} = true, ${c.idCol} = $1, ${c.encCol} = $2, updated_at = now(), updated_by_actor_login_at = $3 WHERE singleton = true`, [c.id!.trim(), enc, Date.now()])
    // Проверка ДО коммита: читаем то, что реально записали, и расшифровываем. При
    // несовпадении throw → транзакция откатывается, carrier не остаётся включённым.
    const stored = (await client.query<{ enc: Buffer }>(`SELECT ${c.encCol} AS enc FROM store_settings WHERE singleton = true`)).rows[0]
    if (!stored?.enc || decryptSecret(stored.enc, c.aad) !== secret) throw new Error(`${name}: проверка расшифровки сохранённого ключа не прошла`)
  })
  console.log(`✓ ${name}: ключи записаны и проверены (значения не логируются)`)
}

async function main() {
  assertSettingsEncKey() // 32 байта, иначе бессмысленно
  await backfill('cdek')
  await backfill('ozon')
  console.log('Backfill завершён. Проверьте /api/checkout/delivery и тестовый заказ, затем выпускайте новый runtime.')
}

main().catch((error) => { console.error('Backfill failed:', error instanceof Error ? error.message : error); process.exitCode = 1 })
