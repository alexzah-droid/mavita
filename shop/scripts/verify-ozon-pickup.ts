// Диагностика живого API Ozon: проверяет наш парсинг point/list + point/info на
// реальных данных (каталожная модель). Ключ НЕ печатается (только маска). Запуск:
//   OZON_CLIENT_ID=... OZON_API_KEY=... npx tsx scripts/verify-ozon-pickup.ts [Город]
import { fetchAllPointIds, fetchPointDetails, getPickupPoint } from '@/lib/ozon'

async function main() {
  const clientId = process.env.OZON_CLIENT_ID?.trim()
  const apiKey = process.env.OZON_API_KEY?.trim()
  const base = (process.env.OZON_API_BASE || 'https://api-seller.ozon.ru').replace(/\/$/, '')
  const city = process.argv[2] || 'Москва'
  if (!clientId || !apiKey) { console.error('Задайте OZON_CLIENT_ID и OZON_API_KEY в env.'); process.exitCode = 1; return }
  // Секреты (включая хвост ключа) НЕ логируем.
  console.log(`base: ${base} · город: ${city}\n`)

  const creds = { clientId, secret: apiKey }

  // 1) point/list — получить все id (живой каталог).
  const ids = await fetchAllPointIds(creds)
  console.log(`point/list → id получено: ${ids.length}`)
  if (!ids.length) { console.error('Список пуст — проверьте права кабинета на Ozon Логистику.'); process.exitCode = 1; return }

  // 2a) СЫРОЙ point/info на первые 5 id — увидеть реальную форму батч-ответа.
  const firstIds = ids.slice(0, 5)
  const rawRes = await fetch(`${base}/v1/delivery/point/info`, {
    method: 'POST', cache: 'no-store',
    headers: { 'Client-Id': clientId, 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ map_point_ids: firstIds }),
  })
  const rawInfo = await rawRes.json().catch(() => null) as Record<string, unknown> | null
  console.log(`\npoint/info HTTP ${rawRes.status} для id=[${firstIds.join(',')}]`)
  console.log('Верхние ключи point/info:', rawInfo ? Object.keys(rawInfo) : null)
  const arr = (rawInfo?.points ?? rawInfo?.result) as unknown[] | undefined
  console.log('Длина массива точек:', Array.isArray(arr) ? arr.length : '(не массив)')
  if (Array.isArray(arr) && arr[0] && typeof arr[0] === 'object') {
    console.log('Ключи первой точки point/info:', Object.keys(arr[0] as object))
    console.log('Первая точка (сырьё):', JSON.stringify(arr[0]).slice(0, 900))
  }

  // 2b) Наш парсинг на тех же id.
  const sample = await fetchPointDetails(creds, firstIds)
  console.log(`\nnormalizeInfoPoint распознал из первых 5: ${sample.length}`)
  for (const p of sample) console.log(`  · [${p.code}] город=«${p.city}» · ${p.name} · ${p.address}`)
  if (sample.length === 0) console.log('⚠️ 0 распознанных — сверьте ключи первой точки выше с normalizeInfoPoint в lib/ozon.ts.')

  // 3) getPickupPoint (re-confirm как при создании заказа) на первом id.
  try {
    const point = await getPickupPoint(creds, String(ids[0]))
    console.log(`\ngetPickupPoint(${ids[0]}) → ${JSON.stringify(point)}`)
    console.log('city непустой:', Boolean(point.city), '· address непустой:', Boolean(point.address))
  } catch (e) { console.log('\ngetPickupPoint ошибка:', e instanceof Error ? e.message : e) }

  console.log(`\nИтог: парсинг работает на живых данных. Город из аргумента («${city}») ищется по локальному каталогу после npm run delivery:sync-ozon, а не здесь.`)
}

main().catch((e) => { console.error('verify failed:', e instanceof Error ? e.message : e); process.exitCode = 1 })
