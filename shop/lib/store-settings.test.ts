import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'

const mocks = vi.hoisted(() => ({ isDbConfigured: vi.fn(() => true), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/db', () => ({ isDbConfigured: mocks.isDbConfigured, query: mocks.query, withTransaction: mocks.withTransaction }))

import { encryptSecret } from '@/lib/secret-box'

// Полная строка singleton с дефолтами; перевозчики выключены и пусты.
function baseRow() {
  return {
    cdek_pickup_enabled: false, cdek_pickup_delivery_kopecks: null, cdek_client_id: null, cdek_client_secret_enc: null,
    updated_at: new Date('2026-06-21T00:00:00Z'), updated_by_actor_login_at: 7,
  }
}
function cdekConfigured(extra: Record<string, unknown> = {}) {
  return { ...baseRow(), cdek_pickup_enabled: true, cdek_pickup_delivery_kopecks: 35000, cdek_client_id: 'cid-123', cdek_client_secret_enc: encryptSecret('cdek-secret', 'cdek:client_secret'), ...extra }
}

beforeEach(() => {
  process.env.SETTINGS_ENC_KEY = randomBytes(32).toString('hex')
  delete process.env.DELIVERY_ENABLED
  mocks.isDbConfigured.mockReturnValue(true)
  mocks.query.mockReset(); mocks.withTransaction.mockReset()
})
afterEach(() => { delete process.env.SETTINGS_ENC_KEY })

describe('resolveDeliveryMode', () => {
  it('DELIVERY_ENABLED=false → disabled (перебивает настройки)', async () => {
    process.env.DELIVERY_ENABLED = 'false'
    const { resolveDeliveryMode } = await import('@/lib/store-settings')
    expect((await resolveDeliveryMode()).mode).toBe('disabled')
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('нет включённых перевозчиков → disabled', async () => {
    mocks.query.mockResolvedValue([baseRow()])
    const { resolveDeliveryMode } = await import('@/lib/store-settings')
    expect((await resolveDeliveryMode()).mode).toBe('disabled')
  })
  it('валидный enabled-перевозчик → pickup_required с тарифом', async () => {
    mocks.query.mockResolvedValue([cdekConfigured()])
    const { resolveDeliveryMode } = await import('@/lib/store-settings')
    const r = await resolveDeliveryMode()
    expect(r.mode).toBe('pickup_required')
    expect(r.carriers).toEqual([{ carrier: 'cdek', deliveryKopecks: 35000 }])
  })
  it('enabled без тарифа → error (fail closed)', async () => {
    mocks.query.mockResolvedValue([cdekConfigured({ cdek_pickup_delivery_kopecks: null })])
    const { resolveDeliveryMode } = await import('@/lib/store-settings')
    expect((await resolveDeliveryMode()).mode).toBe('error')
  })
  it('enabled, но секрет не расшифровывается → error', async () => {
    const bad = cdekConfigured(); (bad.cdek_client_secret_enc as Buffer)[20] ^= 0xff
    mocks.query.mockResolvedValue([bad])
    const { resolveDeliveryMode } = await import('@/lib/store-settings')
    expect((await resolveDeliveryMode()).mode).toBe('error')
  })
  it('одна БД-ошибка → error (не «заказ без ПВЗ»)', async () => {
    mocks.query.mockRejectedValue(new Error('db down'))
    const { resolveDeliveryMode } = await import('@/lib/store-settings')
    expect((await resolveDeliveryMode()).mode).toBe('error')
  })
  it('нет DATABASE_URL и флаг не false → error (fail closed), не disabled', async () => {
    mocks.isDbConfigured.mockReturnValue(false)
    const { resolveDeliveryMode } = await import('@/lib/store-settings')
    expect((await resolveDeliveryMode()).mode).toBe('error')
  })
  it('нет DATABASE_URL, но DELIVERY_ENABLED=false → disabled (глобальный выключатель)', async () => {
    mocks.isDbConfigured.mockReturnValue(false); process.env.DELIVERY_ENABLED = 'false'
    const { resolveDeliveryMode } = await import('@/lib/store-settings')
    expect((await resolveDeliveryMode()).mode).toBe('disabled')
  })
})

describe('credentials access', () => {
  it('getRuntimeCredentials: enabled → секрет + fingerprint', async () => {
    mocks.query.mockResolvedValue([cdekConfigured()])
    const { getRuntimeCredentials } = await import('@/lib/store-settings')
    const creds = await getRuntimeCredentials('cdek')
    expect(creds?.clientId).toBe('cid-123'); expect(creds?.secret).toBe('cdek-secret'); expect(creds?.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
  it('getRuntimeCredentials: выключенный → undefined', async () => {
    mocks.query.mockResolvedValue([cdekConfigured({ cdek_pickup_enabled: false })])
    const { getRuntimeCredentials } = await import('@/lib/store-settings')
    expect(await getRuntimeCredentials('cdek')).toBeUndefined()
  })
  it('getStoredCredentials: расшифровывает даже у выключенного (для /test)', async () => {
    mocks.query.mockResolvedValue([cdekConfigured({ cdek_pickup_enabled: false })])
    const { getStoredCredentials } = await import('@/lib/store-settings')
    expect((await getStoredCredentials('cdek'))?.secret).toBe('cdek-secret')
  })
})

describe('getDeliverySettings (admin DTO)', () => {
  it('возвращает маску и статус, но не открытый секрет', async () => {
    mocks.query.mockResolvedValue([cdekConfigured()])
    const { getDeliverySettings } = await import('@/lib/store-settings')
    const dto = await getDeliverySettings()
    expect(dto.carriers.cdek).toMatchObject({ enabled: true, hasSecret: true, secretMask: '••••cret', clientId: 'cid-123', deliveryKopecks: 35000 })
    expect(JSON.stringify(dto)).not.toContain('cdek-secret')
  })
})

describe('getLockedDeliverySnapshot', () => {
  function client(row: unknown) { return { query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) } }
  it('pickup_required отдаёт тариф и расшифрованные credentials выбранного перевозчика', async () => {
    const { getLockedDeliverySnapshot } = await import('@/lib/store-settings')
    const snap = await getLockedDeliverySnapshot(client(cdekConfigured()))
    expect(snap.mode).toBe('pickup_required')
    const cdek = snap.carrier('cdek')
    expect(cdek?.deliveryKopecks).toBe(35000); expect(cdek?.credentials.secret).toBe('cdek-secret')
  })
  it('сломанный enabled-перевозчик → mode error, carrier() пуст', async () => {
    const { getLockedDeliverySnapshot } = await import('@/lib/store-settings')
    const snap = await getLockedDeliverySnapshot(client(cdekConfigured({ cdek_pickup_delivery_kopecks: null })))
    expect(snap.mode).toBe('error'); expect(snap.carrier('cdek')).toBeUndefined()
  })
  it('FOR SHARE используется при чтении строки настроек', async () => {
    const { getLockedDeliverySnapshot } = await import('@/lib/store-settings')
    const c = client(baseRow())
    await getLockedDeliverySnapshot(c)
    expect((c.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/FOR SHARE/)
  })
})

describe('saveCarrierSettings', () => {
  function fakeTx(currentRow: unknown, returnedRow: unknown) {
    mocks.withTransaction.mockImplementation(async (fn: (c: unknown) => unknown) => fn({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: currentRow ? [currentRow] : [] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [returnedRow] }),                  // UPSERT RETURNING
    }))
  }
  it('включение без полного набора → DeliveryConfigurationError', async () => {
    mocks.withTransaction.mockImplementation(async (fn: (c: unknown) => unknown) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
    const { saveCarrierSettings, DeliveryConfigurationError } = await import('@/lib/store-settings')
    await expect(saveCarrierSettings('cdek', { enabled: true }, 1)).rejects.toBeInstanceOf(DeliveryConfigurationError)
  })
  it('секрет+тариф+enabled в одном запросе проходят (проверка итога)', async () => {
    fakeTx(null, cdekConfigured())
    const { saveCarrierSettings } = await import('@/lib/store-settings')
    const dto = await saveCarrierSettings('cdek', { enabled: true, clientId: 'cid-123', secret: 'cdek-secret', deliveryKopecks: 35000 }, 9)
    expect(dto.carriers.cdek.enabled).toBe(true)
  })
})
