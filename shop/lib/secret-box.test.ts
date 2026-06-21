import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'

const KEY_HEX = randomBytes(32).toString('hex')

beforeEach(() => { process.env.SETTINGS_ENC_KEY = KEY_HEX })
afterEach(() => { delete process.env.SETTINGS_ENC_KEY })

async function load() { return import('@/lib/secret-box') }

describe('secret-box', () => {
  it('round-trips a secret with matching AAD', async () => {
    const { encryptSecret, decryptSecret } = await load()
    const buf = encryptSecret('super-secret-key', 'cdek:client_secret')
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf[0]).toBe(0x01) // версия формата
    expect(decryptSecret(buf, 'cdek:client_secret')).toBe('super-secret-key')
  })

  it('rejects ciphertext decrypted with a different AAD (cannot swap fields)', async () => {
    const { encryptSecret, decryptSecret } = await load()
    const buf = encryptSecret('ozon-api-key', 'ozon:api_key')
    expect(() => decryptSecret(buf, 'cdek:client_secret')).toThrow()
  })

  it('rejects a tampered auth tag', async () => {
    const { encryptSecret, decryptSecret } = await load()
    const buf = encryptSecret('value', 'cdek:client_secret')
    buf[20] ^= 0xff // байт внутри tag/ciphertext
    expect(() => decryptSecret(buf, 'cdek:client_secret')).toThrow()
  })

  it('rejects an unsupported version byte', async () => {
    const { encryptSecret, decryptSecret } = await load()
    const buf = encryptSecret('value', 'cdek:client_secret')
    buf[0] = 0x02
    expect(() => decryptSecret(buf, 'cdek:client_secret')).toThrow(/version/i)
  })

  it('uses a fresh IV per call', async () => {
    const { encryptSecret } = await load()
    const a = encryptSecret('value', 'cdek:client_secret')
    const b = encryptSecret('value', 'cdek:client_secret')
    expect(a.equals(b)).toBe(false)
  })

  it('masks to •••• + last 4', async () => {
    const { maskSecret } = await load()
    expect(maskSecret('abcdef3f2a')).toBe('••••3f2a')
  })

  it('requires a 32-byte key (rejects short / wrong length)', async () => {
    const { settingsEncKey } = await load()
    process.env.SETTINGS_ENC_KEY = 'too-short'
    expect(() => settingsEncKey()).toThrow(/32 bytes/)
    process.env.SETTINGS_ENC_KEY = Buffer.alloc(16).toString('base64')
    expect(() => settingsEncKey()).toThrow(/32 bytes/)
  })

  it('accepts a base64-encoded 32-byte key', async () => {
    const { settingsEncKey } = await load()
    process.env.SETTINGS_ENC_KEY = randomBytes(32).toString('base64')
    expect(settingsEncKey().length).toBe(32)
  })

  it('throws when key is absent', async () => {
    const { settingsEncKey } = await load()
    delete process.env.SETTINGS_ENC_KEY
    expect(() => settingsEncKey()).toThrow(/SETTINGS_ENC_KEY/)
  })
})
