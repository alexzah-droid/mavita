import { describe, expect, it } from 'vitest'
import { cityLabel, localCitySuggestions, mergeCitySuggestions } from './cdek-city-suggestions'

describe('checkout CDEK city suggestions', () => {
  it.each(['санк', 'петерб', 'спб', 'питер', 'Saint Peter'])('%s instantly suggests Санкт-Петербург', (query) => {
    expect(localCitySuggestions(query)[0]).toMatchObject({
      code: 137,
      city: 'Санкт-Петербург',
      region: 'Санкт-Петербург',
    })
  })

  it.each(['мск', 'моск', 'moscow'])('%s instantly suggests Москва', (query) => {
    expect(localCitySuggestions(query)[0]).toMatchObject({
      code: 44,
      city: 'Москва',
      region: 'Москва',
    })
  })

  it('keeps local suggestions first and removes duplicates', () => {
    const local = localCitySuggestions('санк')
    const merged = mergeCitySuggestions(local, [
      { code: 137, city: 'Санкт-Петербург', region: 'Санкт-Петербург' },
      { code: 123, city: 'Санкт-Петербургский', region: 'Тест' },
    ])

    expect(merged.map(cityLabel)).toEqual([
      'Санкт-Петербург, Санкт-Петербург',
      'Санкт-Петербургский, Тест',
    ])
  })
})
