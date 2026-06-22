import { afterEach, describe, expect, it } from 'vitest'
import { dateTimeLocalToInstant, instantToDateTimeLocal } from '@/lib/admin-product-datetime'

const original = process.env.TZ
const withTz = (tz: string, fn: () => void) => { process.env.TZ = tz; try { fn() } finally { process.env.TZ = original } }
afterEach(() => { process.env.TZ = original })

describe('instantToDateTimeLocal', () => {
  it('показывает локальное время браузера, а не срез UTC (Europe/Moscow)', () => {
    withTz('Europe/Moscow', () => expect(instantToDateTimeLocal('2026-06-21T15:00:00.000Z')).toEqual({ ok: true, value: '2026-06-21T18:00' }))
  })
  it('покрывает второй timezone с отличным от UTC смещением (America/New_York)', () => {
    withTz('America/New_York', () => expect(instantToDateTimeLocal('2026-06-21T15:00:00.000Z')).toEqual({ ok: true, value: '2026-06-21T11:00' }))
  })
  it('отвергает не-минутный instant вместо тихого округления', () => {
    expect(instantToDateTimeLocal('2026-06-21T15:00:30.000Z').ok).toBe(false)
    expect(instantToDateTimeLocal('2026-06-21T15:00:00.500Z').ok).toBe(false)
  })
  it('отвергает невалидную дату', () => expect(instantToDateTimeLocal('not-a-date').ok).toBe(false))
})

describe('dateTimeLocalToInstant', () => {
  it('round-trip без изменения значения сохраняет исходный instant', () => {
    withTz('Europe/Moscow', () => {
      const local = instantToDateTimeLocal('2026-06-21T15:00:00.000Z')
      expect(local.ok).toBe(true)
      if (local.ok) expect(dateTimeLocalToInstant(local.value)).toEqual({ ok: true, value: '2026-06-21T15:00:00.000Z' })
    })
  })
  it('round-trip во втором timezone (America/New_York)', () => {
    withTz('America/New_York', () => {
      const local = instantToDateTimeLocal('2026-06-21T15:00:00.000Z')
      if (local.ok) expect(dateTimeLocalToInstant(local.value)).toEqual({ ok: true, value: '2026-06-21T15:00:00.000Z' })
    })
  })
  it('отвергает несуществующее время в DST-gap (Europe/Moscow не имеет gap, проверяем America/New_York)', () => {
    // 2026-03-08 02:30 не существует в America/New_York (переход вперёд в 02:00).
    withTz('America/New_York', () => expect(dateTimeLocalToInstant('2026-03-08T02:30').ok).toBe(false))
  })
  it('отвергает значение без точности до минуты', () => expect(dateTimeLocalToInstant('2026-06-21T18:00:30').ok).toBe(false))
  it('для DST-overlap возвращает момент и предупреждение о выбранном offset', () => {
    // 2026-11-01 01:30 встречается дважды в America/New_York (EDT→EST в 02:00).
    withTz('America/New_York', () => {
      const result = dateTimeLocalToInstant('2026-11-01T01:30')
      expect(result.ok).toBe(true)
      if (result.ok) { expect(result.warning).toBeTruthy(); expect(result.warning).toContain('-04:00') }
    })
  })
  it('определяет 30-минутный DST-overlap (Australia/Lord_Howe)', () => {
    // 2026-04-05 01:45 встречается дважды (откат на 30 минут в 02:00).
    withTz('Australia/Lord_Howe', () => {
      const result = dateTimeLocalToInstant('2026-04-05T01:45')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.warning).toBeTruthy()
    })
  })
  it('для обычного времени предупреждения нет', () => {
    withTz('Europe/Moscow', () => {
      const result = dateTimeLocalToInstant('2026-06-21T18:00')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.warning).toBeUndefined()
    })
  })
})
