// Типы каталога, seed-данные и чистый маппинг строк БД → товар.
// Этот модуль НЕ импортирует БД и безопасен для клиентских компонентов.
// Запросы к БД с фоллбэком на seed — в lib/catalog.ts (только сервер).

export type Product = {
  slug: string
  name: string
  series: string
  subtitle: string
  priceKopecks: number // I2: цена в копейках
  image: string // обложка
  images: string[]
  description: string
  scent: string[]
  inStock: boolean
}

// Строка из SQL-запроса каталога (см. lib/catalog.ts).
export type ProductRow = {
  slug: string
  name: string
  series: string | null
  subtitle: string | null
  description: string | null
  price_kopecks: number | string // pg может вернуть INTEGER как число или строку
  scent: string[] | null
  in_stock: boolean
  cover: string | null
  images: string[] | null
}

/** Чистый маппинг строки БД в Product. Тестируется без подключения к БД. */
export function mapRowToProduct(row: ProductRow): Product {
  const images = (row.images ?? []).filter(Boolean)
  const cover = row.cover || images[0] || ''
  return {
    slug: row.slug,
    name: row.name,
    series: row.series ?? '',
    subtitle: row.subtitle ?? '',
    priceKopecks: Number(row.price_kopecks),
    image: cover,
    images: images.length ? images : cover ? [cover] : [],
    description: row.description ?? '',
    scent: row.scent ?? [],
    inStock: row.in_stock,
  }
}

// ─────────────────────────────────────────────────────────────
// Seed-каталог (серия «Горы»). Используется как фоллбэк, когда БД
// недоступна, и для generateStaticParams при сборке без БД.
// Цены — в копейках (I2).
// ─────────────────────────────────────────────────────────────
export const SEED_PRODUCTS: Product[] = [
  {
    slug: 'kvadratnaya-neizvedannye-tropy',
    name: 'Аромасвеча контейнерная квадратная',
    series: 'Горы · «Неизведанные тропы свободы»',
    subtitle: 'Неизведанные тропы свободы',
    priceKopecks: 180000,
    image: '/images/2.jpeg',
    images: ['/images/2.jpeg'],
    description:
      'Квадратный контейнер из матового стекла с бетонной фактурой. Аромат хвои и холодного горного воздуха — лес после дождя, сосны на высоте. Свеча-медитация: зажгите, считайте QR и окажитесь в горах.',
    scent: ['Пихта', 'Кипарис', 'Можжевельник', 'Мох'],
    inStock: true,
  },
  {
    slug: 'kruglaya-neizvedannye-tropy',
    name: 'Аромасвеча контейнерная круглая',
    series: 'Горы · «Неизведанные тропы свободы»',
    subtitle: 'Неизведанные тропы свободы',
    priceKopecks: 200000,
    image: '/images/3.jpeg',
    images: ['/images/3.jpeg'],
    description:
      'Круглый контейнер — мягкая форма, скрывающая горную твёрдость. Аромат леса на высоте: хвоя, влажный камень, утренний туман. Горит ровно и долго — до 40 часов спокойствия.',
    scent: ['Эвкалипт', 'Пихта', 'Пачули', 'Можжевельник'],
    inStock: true,
  },
  {
    slug: 'lava-moguchiy-pokoy',
    name: 'Аромасвеча «Могущественный покой застывшей лавы»',
    series: 'Горы · «Могущественный покой застывшей лавы»',
    subtitle: 'Могущественный покой застывшей лавы',
    priceKopecks: 180000,
    image: '/images/4.jpeg',
    images: ['/images/4.jpeg'],
    description:
      'Контейнерная свеча в тёмном стекле. Аромат древесины и лавового камня — тёплый, тяжёлый, глубокий. Как горная порода: надёжная, неспешная, вечная. Дарит ощущение опоры.',
    scent: ['Сандал', 'Имбирь', 'Пачули', 'Кипарис'],
    inStock: true,
  },
  {
    slug: 'galka-moguchiy-pokoy',
    name: 'Формовая свеча «Галька»',
    series: 'Горы · «Могущественный покой застывшей лавы»',
    subtitle: 'Могущественный покой застывшей лавы',
    priceKopecks: 90000,
    image: '/images/8.jpeg',
    images: ['/images/8.jpeg'],
    description:
      'Формовая свеча в виде морских камней-галек. Отлита вручную из натурального воска, ароматизирована маслами. Ставится отдельно или в группе — как пирамида камней у горной тропы.',
    scent: ['Имбирь', 'Апельсин', 'Пачули', 'Земля'],
    inStock: true,
  },
]

export function getSeedProduct(slug: string): Product | undefined {
  return SEED_PRODUCTS.find((p) => p.slug === slug)
}

export function seedSlugs(): string[] {
  return SEED_PRODUCTS.map((p) => p.slug)
}
