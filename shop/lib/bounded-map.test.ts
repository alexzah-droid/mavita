import { describe, expect, it } from 'vitest'
import { pruneTtlMap } from '@/lib/bounded-map'

describe('pruneTtlMap', () => {
  it('выметает протухшие записи', () => {
    const map = new Map([
      ['stale', { expiresAt: Date.now() - 1 }],
      ['fresh', { expiresAt: Date.now() + 60_000 }],
    ])
    pruneTtlMap(map, 100)
    expect([...map.keys()]).toEqual(['fresh'])
  })

  it('при переполнении удаляет старейшие, оставляя место под новую запись', () => {
    const map = new Map<string, { expiresAt: number }>()
    const fresh = Date.now() + 60_000
    for (let i = 0; i < 5; i++) map.set(`k${i}`, { expiresAt: fresh })
    pruneTtlMap(map, 3)
    expect(map.size).toBe(2) // после вставки нового ключа будет ровно maxEntries
    expect([...map.keys()]).toEqual(['k3', 'k4'])
  })
})
