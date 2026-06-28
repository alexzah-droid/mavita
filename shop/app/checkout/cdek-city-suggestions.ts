export type CdekCity = { code: number; city: string; region: string | null }

type LocalCity = CdekCity & { aliases: string[] }

export const MOSCOW: CdekCity = { code: 44, city: 'Москва', region: 'Москва' }
export const SAINT_PETERSBURG: CdekCity = { code: 137, city: 'Санкт-Петербург', region: 'Санкт-Петербург' }

function withAliases(city: CdekCity, aliases: string[] = []): LocalCity {
  return { ...city, aliases }
}

function popularCity(code: number, city: string, region: string, aliases: string[] = []): LocalCity {
  return { code, city, region, aliases }
}

const LOCAL_CITIES: LocalCity[] = [
  withAliases(MOSCOW, ['москва', 'мск', 'moscow', 'msk']),
  withAliases(
    SAINT_PETERSBURG,
    [
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
  ),
  popularCity(281, 'Иркутск', 'Иркутская область', ['irkutsk']),
  popularCity(270, 'Новосибирск', 'Новосибирская область', ['нск', 'novosibirsk', 'nsk']),
  popularCity(250, 'Екатеринбург', 'Свердловская область', ['екб', 'ekaterinburg', 'ekb']),
  popularCity(424, 'Казань', 'Татарстан', ['kazan']),
  popularCity(414, 'Нижний Новгород', 'Нижегородская область', ['нн', 'нижновгород', 'nizhny novgorod', 'nn']),
  popularCity(259, 'Челябинск', 'Челябинская область', ['chelyabinsk']),
  popularCity(430, 'Самара', 'Самарская область', ['samara']),
  popularCity(268, 'Омск', 'Омская область', ['omsk']),
  popularCity(438, 'Ростов-на-Дону', 'Ростовская область', ['ростов', 'ростов дон', 'ростовдон', 'rostov']),
  popularCity(256, 'Уфа', 'Республика Башкортостан', ['ufa']),
  popularCity(278, 'Красноярск', 'Красноярский край', ['krasnoyarsk']),
  popularCity(248, 'Пермь', 'Пермский край', ['perm']),
  popularCity(506, 'Воронеж', 'Воронежская область', ['voronezh']),
  popularCity(426, 'Волгоград', 'Волгоградская область', ['volgograd']),
  popularCity(435, 'Краснодар', 'Краснодарский край', ['krasnodar']),
  popularCity(428, 'Саратов', 'Саратовская область', ['saratov']),
  popularCity(252, 'Тюмень', 'Тюменская область', ['tyumen']),
  popularCity(431, 'Тольятти', 'Самарская область', ['тольяти', 'tolyatti']),
  popularCity(274, 'Барнаул', 'Алтайский край', ['barnaul']),
  popularCity(224, 'Ижевск', 'Удмуртия', ['izhevsk']),
  popularCity(422, 'Ульяновск', 'Ульяновская область', ['ulyanovsk']),
  popularCity(288, 'Владивосток', 'Приморский край', ['владив', 'vladivostok']),
  popularCity(146, 'Ярославль', 'Ярославская область', ['yaroslavl']),
  popularCity(287, 'Хабаровск', 'Хабаровский край', ['хабар', 'khabarovsk']),
  popularCity(442, 'Махачкала', 'Дагестан', ['mahachkala']),
  popularCity(261, 'Оренбург', 'Оренбургская область', ['orenburg']),
  popularCity(269, 'Томск', 'Томская область', ['tomsk']),
  popularCity(272, 'Кемерово', 'Кемеровская область - Кузбасс', ['kemerovo']),
  popularCity(273, 'Новокузнецк', 'Кемеровская область - Кузбасс', ['новокуз', 'novokuznetsk']),
  popularCity(159, 'Рязань', 'Рязанская область', ['ryazan']),
  popularCity(432, 'Астрахань', 'Астраханская область', ['astrakhan']),
  popularCity(504, 'Пенза', 'Пензенская область', ['penza']),
  popularCity(320, 'Липецк', 'Липецкая область', ['lipetsk']),
  popularCity(415, 'Киров', 'Кировская область', ['kirov']),
  popularCity(419, 'Чебоксары', 'Чувашская Республика - Чувашия', ['cheboksary']),
  popularCity(152, 'Калининград', 'Калининградская область', ['kaliningrad']),
  popularCity(150, 'Тула', 'Тульская область', ['tula']),
  popularCity(699, 'Курск', 'Курская область', ['kursk']),
  popularCity(439, 'Ставрополь', 'Ставропольский край', ['stavropol']),
  popularCity(437, 'Сочи', 'Краснодарский край', ['sochi']),
  popularCity(337, 'Белгород', 'Белгородская область', ['belgorod']),
  popularCity(402, 'Архангельск', 'Архангельская область', ['arkhangelsk']),
  popularCity(246, 'Вологда', 'Вологодская область', ['vologda']),
  popularCity(265, 'Мурманск', 'Мурманская область', ['murmansk']),
  popularCity(433, 'Набережные Челны', 'Татарстан', ['челны', 'набереж', 'naberezhnye chelny']),
  popularCity(254, 'Сургут', 'Ханты-Мансийский автономный округ - Югра', ['surgut']),
  popularCity(283, 'Якутск', 'Республика Саха (Якутия)', ['yakutsk']),
  popularCity(473, 'Южно-Сахалинск', 'Сахалинская область', ['южно', 'сахалинск', 'южносахалинск', 'yuzhno']),
  popularCity(230, 'Улан-Удэ', 'Республика Бурятия', ['улан', 'улан удэ', 'уланудэ', 'ulan ude']),
  popularCity(231, 'Чита', 'Забайкальский край', ['chita']),
  popularCity(395, 'Смоленск', 'Смоленская область', ['smolensk']),
  popularCity(220, 'Брянск', 'Брянская область', ['bryansk']),
  popularCity(94, 'Владимир', 'Владимирская область', ['vladimir']),
  popularCity(164, 'Иваново', 'Ивановская область', ['ivanovo']),
  popularCity(142, 'Калуга', 'Калужская область', ['kaluga']),
  popularCity(245, 'Тверь', 'Тверская область', ['tver']),
  popularCity(139, 'Великий Новгород', 'Новгородская область', ['великий', 'велновгород', 'veliky novgorod']),
  popularCity(393, 'Псков', 'Псковская область', ['pskov']),
  popularCity(15256, 'Севастополь', 'Севастополь', ['sevastopol']),
  popularCity(15345, 'Симферополь', 'Республика Крым', ['simferopol']),
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
