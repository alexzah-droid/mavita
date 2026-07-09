import { isDbConfigured, query } from '@/lib/db'

export const DEFAULT_ABOUT_TEXT = `Я Виктория, основатель МАВИТА. Наш дом всегда был связан с горами: отец — альпинист, и любовь к высоте, камню и тишине пришла оттуда.

Каждая свеча — это маленькое путешествие. Вы приходите домой: пробки, задачи, энергия на нуле. Берёте свечу в руки — она тяжёлая, фактурная, настоящая. Зажигаете. Считываете QR на открытке с сургучной печатью. Включается звук горной реки, шелест листвы, дыхание моря. Вы садитесь в кресло — и наполняетесь.

Здесь только натуральные масла: пачули, эвкалипт, кипарис, можжевельник, пихта, апельсин, имбирь. Лучшее, что может дать природа — собранное с заботой о вас.`

export const ABOUT_TEXT_MAX_LENGTH = 5000
export const STIHII_TEXT_MAX_LENGTH = 1000

export type StihiyaContent = {
  state: string
  desc: string
  scents: string
}

export type StihiiContent = {
  gory: StihiyaContent
  more: StihiyaContent
  les: StihiyaContent
}

export const DEFAULT_STIHII: StihiiContent = {
  gory: {
    state: 'Ясность · Сила',
    desc: 'Холодный воздух, камень, древесина, лава. Высота тишины. Ощущение внутренней опоры — как горная порода: надёжная, неспешная, вечная.',
    scents: 'Кипарис · Можжевельник · Камень · Лава',
  },
  more: {
    state: 'Расслабление · Отпускание',
    desc: 'Соль, озон, бриз, минералы. Закат у воды. Ощущение пространства — когда горизонт раздвигается и можно просто дышать.',
    scents: 'Озон · Соль · Минералы · Бриз',
  },
  les: {
    state: 'Заземление · Безопасность',
    desc: 'Мох, хвоя, влажная земля, папоротник. Лес после дождя. Ощущение опоры и защиты — как под кроной старого дерева.',
    scents: 'Пихта · Эвкалипт · Мох · Хвоя',
  },
}

type SiteContentRow = { about_text: string; stihii: StihiiContent; updated_at: Date | string }
export type SiteContent = { aboutText: string; stihii: StihiiContent; updatedAt: string | null }

export async function getSiteContent(): Promise<SiteContent> {
  if (!isDbConfigured()) return { aboutText: DEFAULT_ABOUT_TEXT, stihii: DEFAULT_STIHII, updatedAt: null }
  const rows = await query<SiteContentRow>('SELECT about_text, stihii, updated_at FROM site_content WHERE singleton = true')
  const row = rows[0]
  return row
    ? { aboutText: row.about_text, stihii: row.stihii, updatedAt: new Date(row.updated_at).toISOString() }
    : { aboutText: DEFAULT_ABOUT_TEXT, stihii: DEFAULT_STIHII, updatedAt: null }
}

export function validateAboutText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (!normalized || normalized.length > ABOUT_TEXT_MAX_LENGTH) return undefined
  return normalized
}

export function validateStihii(value: unknown): StihiiContent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (Object.keys(input).sort().join(',') !== 'gory,les,more') return undefined
  const result = {} as StihiiContent
  for (const key of ['gory', 'more', 'les'] as const) {
    const tile = input[key]
    if (!tile || typeof tile !== 'object' || Array.isArray(tile)) return undefined
    const fields = tile as Record<string, unknown>
    if (Object.keys(fields).sort().join(',') !== 'desc,scents,state') return undefined
    const normalized = {} as StihiyaContent
    for (const field of ['state', 'desc', 'scents'] as const) {
      if (typeof fields[field] !== 'string') return undefined
      const text = fields[field].replace(/\r\n?/g, '\n').trim()
      if (!text || text.length > STIHII_TEXT_MAX_LENGTH) return undefined
      normalized[field] = text
    }
    result[key] = normalized
  }
  return result
}

export async function saveSiteContent(aboutText: string, stihii: StihiiContent, actorLoginAt: number): Promise<SiteContent> {
  const rows = await query<SiteContentRow>(
    `INSERT INTO site_content (singleton, about_text, stihii, updated_at, updated_by_actor_login_at)
     VALUES (true, $1, $2::jsonb, now(), $3)
     ON CONFLICT (singleton) DO UPDATE SET about_text = EXCLUDED.about_text, stihii = EXCLUDED.stihii,
       updated_at = now(), updated_by_actor_login_at = EXCLUDED.updated_by_actor_login_at
     RETURNING about_text, stihii, updated_at`,
    [aboutText, JSON.stringify(stihii), actorLoginAt],
  )
  const row = rows[0]
  return { aboutText: row.about_text, stihii: row.stihii, updatedAt: new Date(row.updated_at).toISOString() }
}
