export type CdekCity = { code: number; city: string; region: string | null }

type LocalCity = CdekCity & { aliases: string[] }

export const MOSCOW: CdekCity = { code: 44, city: 'Москва', region: 'Москва' }
export const SAINT_PETERSBURG: CdekCity = { code: 137, city: 'Санкт-Петербург', region: 'Санкт-Петербург' }

const LOCAL_CITIES: LocalCity[] = [
  { ...MOSCOW, aliases: ['москва', 'мск', 'moscow', 'msk'] },
  {
    ...SAINT_PETERSBURG,
    aliases: [
      'санкт-петербург',
      'санкт петербург',
      'санктпетербург',
      'санк',
      'петербург',
      'петерб',
      'спб',
      'питер',
      'spb',
      'sankt',
      'peterburg',
      'saint petersburg',
      'saintpetersburg',
    ],
  },
]

function compact(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '')
}

export function cityLabel(c: CdekCity) {
  return c.region ? `${c.city}, ${c.region}` : c.city
}

export function localCitySuggestions(query: string): CdekCity[] {
  const q = compact(query)
  if (q.length < 2) return []
  return LOCAL_CITIES
    .filter((city) => {
      const names = [city.city, city.region ?? '', ...city.aliases].map(compact)
      return names.some((name) => name.startsWith(q) || (q.length >= 3 && name.includes(q)))
    })
    .map(({ aliases: _aliases, ...city }) => city)
}

export function mergeCitySuggestions(primary: CdekCity[], secondary: CdekCity[]) {
  const seen = new Set<number>()
  const result: CdekCity[] = []
  for (const city of [...primary, ...secondary]) {
    if (seen.has(city.code)) continue
    seen.add(city.code)
    result.push(city)
  }
  return result
}
