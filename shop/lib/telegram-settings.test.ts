import { afterEach, describe, expect, it } from 'vitest'
import { decryptTelegramToken, encryptTelegramToken, validateTelegramChatId, validateTelegramToken } from '@/lib/telegram-settings'

const original = process.env.TELEGRAM_SETTINGS_ENCRYPTION_KEY
afterEach(() => { if (original === undefined) delete process.env.TELEGRAM_SETTINGS_ENCRYPTION_KEY; else process.env.TELEGRAM_SETTINGS_ENCRYPTION_KEY = original })

describe('Telegram credentials', () => {
  it('round-trips AES-GCM and rejects a tampered authentication tag', () => {
    process.env.TELEGRAM_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    const encrypted = encryptTelegramToken('123456:abcdefghijklmnopqrstuv')
    expect(decryptTelegramToken({ bot_token_ciphertext: encrypted.ciphertext, bot_token_iv: encrypted.iv, bot_token_auth_tag: encrypted.authTag })).toBe('123456:abcdefghijklmnopqrstuv')
    const tag = Buffer.from(encrypted.authTag); tag[0] ^= 1
    expect(() => decryptTelegramToken({ bot_token_ciphertext: encrypted.ciphertext, bot_token_iv: encrypted.iv, bot_token_auth_tag: tag })).toThrow()
  })

  it('validates tokens and retains chat IDs as strings', () => {
    expect(validateTelegramToken('123456:abcdefghijklmnopqrstuv')).toBeDefined(); expect(validateTelegramToken('bad')).toBeUndefined()
    expect(validateTelegramChatId('-1001234567890')).toBe('-1001234567890'); expect(validateTelegramChatId('')).toBeUndefined()
  })
})
