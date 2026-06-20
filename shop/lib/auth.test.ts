import { afterEach, describe, expect, it } from 'vitest'
import { assertAuthConfig, verifyPassword } from '@/lib/auth'

const original = { password: process.env.ADMIN_PASSWORD, secret: process.env.SESSION_SECRET }
afterEach(() => {
  if (original.password === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = original.password
  if (original.secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = original.secret
})

describe('admin auth primitives', () => {
  it('rejects empty password and a short session secret', () => {
    process.env.ADMIN_PASSWORD = ''; process.env.SESSION_SECRET = 'short'
    expect(assertAuthConfig).toThrow('ADMIN_PASSWORD')
    process.env.ADMIN_PASSWORD = 'secret'; expect(assertAuthConfig).toThrow('SESSION_SECRET')
  })
  it('accepts only a configured password, including a different input length', () => {
    process.env.ADMIN_PASSWORD = 'secret'; process.env.SESSION_SECRET = 'x'.repeat(32)
    expect(assertAuthConfig).not.toThrow()
    expect(verifyPassword('secret', 'secret')).toBe(true)
    expect(verifyPassword('no', 'secret')).toBe(false)
    expect(verifyPassword('', 'secret')).toBe(false)
  })
})
