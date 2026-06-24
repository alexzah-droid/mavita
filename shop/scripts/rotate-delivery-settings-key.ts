// Ротация мастер-ключа SETTINGS_ENC_KEY. Контролируемая ОФЛАЙН-операция, а не смена
// переменной в работающем процессе. Перед запуском: backup БД, maintenance, все
// app/worker-процессы остановлены (PATCH/test/checkout недоступны).
//
// Запуск:
//   SETTINGS_ENC_KEY_OLD=<старый> SETTINGS_ENC_KEY=<новый> DATABASE_URL=... \
//   npx tsx scripts/rotate-delivery-settings-key.ts
//
// Под блокировкой singleton перешифровывает все *_enc старым→новым ключом и в конце
// проверяет каждый результат. При любой ошибке транзакция откатывается — старый ключ
// остаётся рабочим. После успеха: убрать SETTINGS_ENC_KEY_OLD, поднять приложение
// только с новым ключом. Rollback после commit = восстановление backup БД + старого
// ключа (поэтому ключ нельзя менять без backup). Значения секретов НЕ печатаются.
import { withTransaction } from '@/lib/db'
import { decryptSecret, encryptSecret, parseEncKey } from '@/lib/secret-box-core'

const FIELDS: { carrier: string; col: string; aad: string }[] = [
  { carrier: 'cdek', col: 'cdek_client_secret_enc', aad: 'cdek:client_secret' },
]

async function main() {
  const oldKey = parseEncKey(process.env.SETTINGS_ENC_KEY_OLD, 'SETTINGS_ENC_KEY_OLD')
  const newKey = parseEncKey(process.env.SETTINGS_ENC_KEY, 'SETTINGS_ENC_KEY')
  if (oldKey.equals(newKey)) { console.log('OLD и NEW ключи совпадают — ротация не нужна.'); return }

  const rotated = await withTransaction(async (client) => {
    const row = (await client.query<Record<string, Buffer | null>>(
      `SELECT ${FIELDS.map((f) => f.col).join(', ')} FROM store_settings WHERE singleton = true FOR UPDATE`,
    )).rows[0]
    if (!row) { return [] as string[] }
    const done: string[] = []
    for (const f of FIELDS) {
      const enc = row[f.col]
      if (!enc) continue
      const plain = decryptSecret(enc, f.aad, oldKey)       // расшифровка старым ключом
      const reenc = encryptSecret(plain, f.aad, newKey)     // шифрование новым
      if (decryptSecret(reenc, f.aad, newKey) !== plain) throw new Error(`verify failed for ${f.col}`)
      await client.query(`UPDATE store_settings SET ${f.col} = $1 WHERE singleton = true`, [reenc])
      done.push(f.carrier)
    }
    return done
  })

  console.log(rotated.length ? `✓ Перешифровано: ${rotated.join(', ')}. Уберите SETTINGS_ENC_KEY_OLD и поднимите приложение с новым ключом.` : 'Шифрованных секретов нет — нечего ротировать.')
}

main().catch((error) => { console.error('Rotation failed (транзакция откачена, старый ключ рабочий):', error instanceof Error ? error.message : error); process.exitCode = 1 })
