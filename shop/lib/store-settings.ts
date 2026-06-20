import { isDbConfigured, query } from '@/lib/db'

export type DeliverySettings = { cdekPickupDeliveryKopecks: number; updatedAt: string; updatedByActorLoginAt: number }

export function validateDeliveryKopecks(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function dto(row: { cdek_pickup_delivery_kopecks: number | string; updated_at: Date | string; updated_by_actor_login_at: number | string }): DeliverySettings {
  return { cdekPickupDeliveryKopecks: Number(row.cdek_pickup_delivery_kopecks), updatedAt: new Date(row.updated_at).toISOString(), updatedByActorLoginAt: Number(row.updated_by_actor_login_at) }
}

export async function getDeliverySettings(): Promise<DeliverySettings | undefined> {
  if (!isDbConfigured()) return undefined
  const rows = await query<{ cdek_pickup_delivery_kopecks: number | string; updated_at: Date | string; updated_by_actor_login_at: number | string }>('SELECT cdek_pickup_delivery_kopecks, updated_at, updated_by_actor_login_at FROM store_settings WHERE singleton = true')
  return rows[0] ? dto(rows[0]) : undefined
}

export async function saveDeliverySettings(cdekPickupDeliveryKopecks: number, actorLoginAt: number): Promise<DeliverySettings> {
  const rows = await query<{ cdek_pickup_delivery_kopecks: number | string; updated_at: Date | string; updated_by_actor_login_at: number | string }>(
    `INSERT INTO store_settings (singleton, cdek_pickup_delivery_kopecks, updated_at, updated_by_actor_login_at)
     VALUES (true, $1, now(), $2)
     ON CONFLICT (singleton) DO UPDATE SET cdek_pickup_delivery_kopecks = EXCLUDED.cdek_pickup_delivery_kopecks, updated_at = now(), updated_by_actor_login_at = EXCLUDED.updated_by_actor_login_at
     RETURNING cdek_pickup_delivery_kopecks, updated_at, updated_by_actor_login_at`, [cdekPickupDeliveryKopecks, actorLoginAt],
  )
  return dto(rows[0])
}
