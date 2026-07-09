import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), configured: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: mocks.query, isDbConfigured: mocks.configured }))

beforeEach(() => { mocks.query.mockReset(); mocks.configured.mockReset() })

describe('site content', () => {
  it('uses the bundled text when the database is unavailable', async () => {
    mocks.configured.mockReturnValue(false)
    const { DEFAULT_ABOUT_TEXT, DEFAULT_STIHII, getSiteContent } = await import('@/lib/site-content')
    await expect(getSiteContent()).resolves.toEqual({ aboutText: DEFAULT_ABOUT_TEXT, stihii: DEFAULT_STIHII, updatedAt: null })
  })

  it('normalizes and validates admin text', async () => {
    const { validateAboutText } = await import('@/lib/site-content')
    expect(validateAboutText('  Первый\r\n\r\nВторой  ')).toBe('Первый\n\nВторой')
    expect(validateAboutText('   ')).toBeUndefined()
    expect(validateAboutText('x'.repeat(5001))).toBeUndefined()
  })

  it('accepts only complete non-empty content for all three element tiles', async () => {
    const { DEFAULT_STIHII, validateStihii } = await import('@/lib/site-content')
    expect(validateStihii(DEFAULT_STIHII)).toEqual(DEFAULT_STIHII)
    expect(validateStihii({ ...DEFAULT_STIHII, gory: { ...DEFAULT_STIHII.gory, state: ' ' } })).toBeUndefined()
    expect(validateStihii({ ...DEFAULT_STIHII, extra: DEFAULT_STIHII.gory })).toBeUndefined()
  })
})
