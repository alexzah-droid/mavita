import { afterEach, describe, expect, it, vi } from 'vitest'
import { CdekValidationError, listPickupPoints } from '@/lib/cdek'

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
