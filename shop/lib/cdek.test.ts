import { afterEach, describe, expect, it, vi } from 'vitest'
import { CdekValidationError, listPickupPoints, listPickupPointsByCityCode, resolveCity, suggestCities } from '@/lib/cdek'

// Уникальные creds на тест: кэш токена в cdek.ts ключуется fingerprint'ом,
// поэтому разные ключи исключают переиспользование токена между тестами.
function sequence(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  const fn = vi.fn()
  for (const r of responses) fn.mockResolvedValueOnce({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), json: async () => r.body } as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => vi.unstubAllGlobals())

describe('cdek auth_failed propagation', () => {
  it('401 на OAuth → CdekValidationError(authFailed), а не generic unavailable', async () => {
    sequence([{ ok: false, status: 401, body: {} }])
    await expect(listPickupPoints({ clientId: 'a1', secret: 's1' }, 'Москва')).rejects.toMatchObject({ unavailable: true, authFailed: true })
  })
  it('успешный токен, затем 403 на deliverypoints → authFailed', async () => {
    sequence([
      { ok: true, status: 200, body: { access_token: 't', expires_in: 300 } },
      { ok: false, status: 403, body: {} },
    ])
    await expect(listPickupPoints({ clientId: 'a2', secret: 's2' }, 'Москва')).rejects.toMatchObject({ authFailed: true })
  })
  it('успешный токен, затем сетевой сбой → unavailable без authFailed', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 300 }) } as Response)
      .mockRejectedValueOnce(new Error('network'))
    vi.stubGlobal('fetch', fn)
    const err = await listPickupPoints({ clientId: 'a3', secret: 's3' }, 'Москва').catch((e) => e)
    expect(err).toBeInstanceOf(CdekValidationError)
    expect(err.unavailable).toBe(true); expect(err.authFailed).toBe(false)
  })
})

describe('cdek фильтр по city_code (фикс бага со свободным city)', () => {
  it('listPickupPointsByCityCode шлёт city_code + type=PVZ, а не название города', async () => {
    const fn = sequence([
      { ok: true, status: 200, body: { access_token: 't', expires_in: 300 } },
      { ok: true, status: 200, body: [
        { code: 'MSK1', location: { city: 'Москва', address: 'ул. Ленина, 1' }, name: 'ПВЗ-1' },
        { code: 'MSK2', location: { city: 'Москва', address: 'ул. Мира, 2' }, name: 'ПВЗ-2' },
      ] },
    ])
    const points = await listPickupPointsByCityCode({ clientId: 'b1', secret: 's1' }, 44)
    expect(points).toHaveLength(2)
    const url = String(fn.mock.calls[1][0])
    expect(url).toContain('/deliverypoints?')
    expect(url).toContain('city_code=44')
    expect(url).toContain('type=PVZ')
    expect(url).not.toContain('city=') // именно city_code, не name
  })

  it('listPickupPoints без города не ходит в API и возвращает [] (не национальный список)', async () => {
    const fn = vi.fn(); vi.stubGlobal('fetch', fn)
    expect(await listPickupPoints({ clientId: 'b2', secret: 's2' })).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('resolveCity предпочитает точное совпадение названия', async () => {
    sequence([
      { ok: true, status: 200, body: { access_token: 't', expires_in: 300 } },
      { ok: true, status: 200, body: [
        { code: 137, city: 'Новосибирск', region: 'Новосибирская обл.' },
        { code: 999, city: 'Новосибирский', region: 'Другая обл.' },
      ] },
    ])
    expect(await resolveCity({ clientId: 'b3', secret: 's3' }, 'Новосибирск')).toEqual({ code: 137, city: 'Новосибирск', region: 'Новосибирская обл.' })
  })

  it('listPickupPoints(name) резолвит город → city_code → ПВЗ', async () => {
    const fn = sequence([
      { ok: true, status: 200, body: { access_token: 't', expires_in: 300 } },
      { ok: true, status: 200, body: [{ code: 44, city: 'Москва', region: 'Москва' }] },
      { ok: true, status: 200, body: [{ code: 'X', location: { city: 'Москва', address: 'A' }, name: 'N' }] },
    ])
    expect(await listPickupPoints({ clientId: 'b4', secret: 's4' }, 'Москва')).toHaveLength(1)
    expect(String(fn.mock.calls[1][0])).toContain('/location/cities?')
    expect(String(fn.mock.calls[2][0])).toContain('city_code=44')
  })

  it('suggestCities нормализует и отбрасывает записи без валидного code', async () => {
    sequence([
      { ok: true, status: 200, body: { access_token: 't', expires_in: 300 } },
      { ok: true, status: 200, body: [
        { code: 270, city: 'Санкт-Петербург', region: 'Санкт-Петербург' },
        { code: 0, city: 'Плохой' },
        { city: 'Без кода' },
      ] },
    ])
    expect(await suggestCities({ clientId: 'b5', secret: 's5' }, 'Сан')).toEqual([{ code: 270, city: 'Санкт-Петербург', region: 'Санкт-Петербург' }])
  })
})
