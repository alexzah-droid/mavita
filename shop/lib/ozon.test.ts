import { afterEach, describe, expect, it, vi } from 'vitest'
import { cityOf, fetchAllPointIds, fetchPointDetails, getPickupPoint, normalizeInfoPoint, OzonValidationError } from '@/lib/ozon'

const creds = { clientId: 'cid', secret: 'key' }
function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status, statusText: 'x', json: async () => body, text: async () => JSON.stringify(body) } as Response))
}
afterEach(() => vi.unstubAllGlobals())

// Реальная форма point/info (проверено живым ключом): всё под delivery_method,
// включая map_point_id (на верхнем уровне точки его нет).
const infoPoint = {
  delivery_method: {
    map_point_id: 528861,
    address: 'Россия, Республика Татарстан, село Тюрнясево, улица Садовая, 31',
    address_details: { city: '', region: 'Татарстан', street: '', house: '' },
    coordinates: { lat: 54.58, long: 50.58 },
    name: 'Пункт Ozon',
  },
}
const mskPoint = {
  delivery_method: {
    map_point_id: 100,
    address: 'Россия, Москва, ул. Тверская, 1',
    address_details: { city: 'Москва', region: 'Москва', street: 'Тверская', house: '1' },
    coordinates: { lat: 55.7, long: 37.6 },
    name: 'Пункт Ozon',
  },
}

describe('ozon cityOf', () => {
  it('берёт address_details.city, если задан', () => { expect(cityOf({ city: 'Москва', region: 'Москва' }, 'addr')).toBe('Москва') })
  it('парсит локаль из address по префиксу «село/город»', () => { expect(cityOf({ city: '', region: 'Татарстан' }, 'РФ, село Тюрнясево, ул. Садовая')).toBe('Тюрнясево') })
  it('берёт населённый пункт перед улицей (село без префикса)', () => {
    expect(cityOf({ city: '', region: 'Ленинградская' }, 'Россия, Ленинградская, Лужский, Осьмино, улица Ленина, 50')).toBe('Осьмино')
  })
  it('не принимает за город административный сегмент перед улицей', () => {
    // нет населённого пункта перед улицей → фоллбэк на region
    expect(cityOf({ city: '', region: 'Москва' }, 'Россия, Москва, район Тверской, улица 1')).not.toBe('район Тверской')
  })
  it('фоллбэк на region, затем РФ', () => {
    expect(cityOf({ city: '', region: 'Татарстан' }, 'Россия, Республика Дагестан, Ахвахский район, кутан')).toBe('Татарстан')
    expect(cityOf({ city: '', region: '' }, 'без локали')).toBe('РФ')
  })
})

describe('ozon normalizeInfoPoint', () => {
  it('разбирает delivery_method в детальную точку', () => {
    expect(normalizeInfoPoint(mskPoint)).toEqual({ code: '100', city: 'Москва', name: 'Пункт Ozon', address: 'Россия, Москва, ул. Тверская, 1', lat: 55.7, lng: 37.6 })
  })
  it('город парсится из address (село …), когда address_details.city пуст', () => {
    expect(normalizeInfoPoint(infoPoint)?.city).toBe('Тюрнясево')
  })
  it('без delivery_method/адреса → undefined', () => {
    expect(normalizeInfoPoint({ map_point_id: 1 })).toBeUndefined()
  })
})

describe('ozon API calls', () => {
  it('fetchAllPointIds возвращает map_point_id из point/list', async () => {
    mockFetch({ points: [{ map_point_id: 1, coordinate: {} }, { map_point_id: 2, coordinate: {} }] })
    expect(await fetchAllPointIds(creds)).toEqual([1, 2])
  })
  it('fetchPointDetails запрещает >100 id', async () => {
    await expect(fetchPointDetails(creds, Array.from({ length: 101 }, (_, i) => i))).rejects.toBeInstanceOf(OzonValidationError)
  })
  it('getPickupPoint подтверждает код через point/info', async () => {
    mockFetch({ points: [mskPoint] })
    expect(await getPickupPoint(creds, '100')).toEqual({ code: '100', city: 'Москва', name: 'Пункт Ozon', address: 'Россия, Москва, ул. Тверская, 1' })
  })
  it('getPickupPoint при несовпадении кода → OzonValidationError', async () => {
    mockFetch({ points: [mskPoint] })
    await expect(getPickupPoint(creds, '999')).rejects.toBeInstanceOf(OzonValidationError)
  })
  it('401 → OzonValidationError(authFailed)', async () => {
    mockFetch({}, false, 401)
    await expect(fetchAllPointIds(creds)).rejects.toMatchObject({ unavailable: true, authFailed: true })
  })
  it('передаёт Client-Id/Api-Key и не светит ключ в URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ points: [] }) } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await fetchAllPointIds(creds)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).not.toContain('key')
    expect((init as RequestInit).headers).toMatchObject({ 'Client-Id': 'cid', 'Api-Key': 'key' })
  })
})
