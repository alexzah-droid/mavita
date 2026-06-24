import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ creds: vi.fn(), proxy: vi.fn(), allow: vi.fn() }))
vi.mock('@/lib/store-settings', () => ({ getRuntimeCredentials: mocks.creds, DeliveryConfigurationError: class extends Error {} }))
vi.mock('@/lib/cdek', () => ({ cdekWidgetProxy: mocks.proxy }))
vi.mock('@/lib/public-rate-limit', () => ({ allowRequest: mocks.allow, clientIp: () => '1.2.3.4' }))

beforeEach(() => {
  mocks.creds.mockReset(); mocks.proxy.mockReset(); mocks.allow.mockReset()
  mocks.allow.mockReturnValue(true)
  mocks.creds.mockResolvedValue({ clientId: 'c', secret: 's' })
})

const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init)

describe('GET/POST /api/cdek/widget (servicePath)', () => {
  it('cdek выключен → 503', async () => {
    mocks.creds.mockResolvedValue(undefined)
    const { GET } = await import('@/app/api/cdek/widget/route')
    expect((await GET(req('/api/cdek/widget?action=offices'))).status).toBe(503)
  })

  it('rate limit → 429', async () => {
    mocks.allow.mockReturnValue(false)
    const { GET } = await import('@/app/api/cdek/widget/route')
    expect((await GET(req('/api/cdek/widget?action=offices'))).status).toBe(429)
  })

  it('нет/неизвестный action → 400', async () => {
    const { GET } = await import('@/app/api/cdek/widget/route')
    expect((await GET(req('/api/cdek/widget'))).status).toBe(400)
    expect((await GET(req('/api/cdek/widget?action=bogus'))).status).toBe(400)
  })

  it('offices → GET-параметры (без action) в прокси, тело verbatim', async () => {
    mocks.proxy.mockResolvedValue({ status: 200, body: '[{"code":"SPB116"}]' })
    const { GET } = await import('@/app/api/cdek/widget/route')
    const res = await GET(req('/api/cdek/widget?action=offices&city_code=137'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('[{"code":"SPB116"}]')
    expect(mocks.proxy).toHaveBeenCalledWith({ clientId: 'c', secret: 's' }, 'offices', { city_code: '137', type: 'PVZ' })
  })

  it('offices → type=PVZ форсируется, даже если клиент прислал иной тип', async () => {
    mocks.proxy.mockResolvedValue({ status: 200, body: '[]' })
    const { GET } = await import('@/app/api/cdek/widget/route')
    await GET(req('/api/cdek/widget?action=offices&city_code=44&type=POSTAMAT'))
    expect(mocks.proxy).toHaveBeenCalledWith({ clientId: 'c', secret: 's' }, 'offices', { city_code: '44', type: 'PVZ' })
  })

  it('calculate POST → action из тела, остальное JSON в прокси', async () => {
    mocks.proxy.mockResolvedValue({ status: 200, body: '{"tariff_codes":[]}' })
    const { POST } = await import('@/app/api/cdek/widget/route')
    const res = await POST(req('/api/cdek/widget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'calculate', tariff_code: 136 }) }))
    expect(res.status).toBe(200)
    expect(mocks.proxy).toHaveBeenCalledWith({ clientId: 'c', secret: 's' }, 'calculate', { tariff_code: 136 })
  })
})
