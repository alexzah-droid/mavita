// Типы каталога, seed-данные и чистый маппинг строк БД → товар.
// Этот модуль НЕ импортирует БД и безопасен для клиентских компонентов.
// Запросы к БД с фоллбэком на seed — в lib/catalog.ts (только сервер).

export type Visibility = 'public' | 'unlisted' | 'hidden'

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
  visibility: Visibility
  sale: { priceKopecks: number; startsAt: string | null; endsAt: string | null } | null
  // Доп. атрибуты карточки (источник — docs/source/goods.md). Необязательны:
  // у товаров из БД отсутствуют, у seed-каталога заполнены.
  category?: string // «Аромасвеча» / «Свеча»
  aroma?: string // описание аромата одной строкой
  tagline?: string // слоган-подпись (курсивом)
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
  visibility?: Visibility | null
  sale_price_kopecks?: number | string | null
  sale_starts_at?: Date | string | null
  sale_ends_at?: Date | string | null
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
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
    visibility: row.visibility ?? 'public',
    sale: row.sale_price_kopecks == null ? null : {
      priceKopecks: Number(row.sale_price_kopecks),
      startsAt: iso(row.sale_starts_at),
      endsAt: iso(row.sale_ends_at),
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Seed-каталог (серия «Горы»). Используется как фоллбэк, когда БД
// недоступна, и для generateStaticParams при сборке без БД.
// Цены — в копейках (I2).
// ─────────────────────────────────────────────────────────────
export const SEED_PRODUCTS: Product[] = [
  {
    slug: 'kamennaya-piramida',
    name: 'Каменная пирамида',
    series: 'Горы',
    category: 'Аромасвеча',
    subtitle: 'Ты — первооткрыватель!',
    aroma: 'Аромат путешествий, свежего лесного воздуха и духа приключений.',
    tagline: 'Ты — первооткрыватель.',
    priceKopecks: 160000,
    image: '/images/catalog/001/001-01.png',
    images: [
      '/images/catalog/001/001-01.png',
      '/images/catalog/001/001-02.jpg',
      '/images/catalog/001/001-03.jpg',
      '/images/catalog/001/001-04.jpg',
      '/images/catalog/001/001-05.jpg',
    ],
    description:
      'Стильная ароматная пирамида из двух контейнерных свечей и универсальной крышки, которая подходит к обеим ёмкостям. «Ты — первооткрыватель!» — это аромат путешествий, свежего лесного воздуха, духа приключений. 100% натуральный соевый воск раскрывает аромат наилучшим образом: сначала вас захватывают ноты свежей травы и бергамота, затем свеча раскрывается эвкалиптом, пихтой и можжевельником, чтобы потом подарить невероятное тепло кожи и пачули. Целое путешествие в одной свече станет настоящим приключением и отличным подарком. Свеча бережно упаковывается в брендированную подарочную коробку с надёжной защитой.',
    scent: ['Свежая трава', 'Бергамот', 'Эвкалипт', 'Пихта', 'Можжевельник', 'Тепло кожи', 'Пачули'],
    inStock: true,
    visibility: 'public',
    sale: null,
  },
  {
    slug: 'simfoniya-kamney-1-cilindr',
    name: 'Симфония камней №1 (цилиндр)',
    series: 'Горы',
    category: 'Аромасвеча',
    subtitle: 'Ты — первооткрыватель!',
    aroma: 'Аромат путешествий, свежего лесного воздуха и духа приключений.',
    tagline: 'Прикоснись к камню — и зажги.',
    priceKopecks: 200000,
    image: '/images/catalog/002/002-01.jpg',
    images: [
      '/images/catalog/002/002-01.jpg',
      '/images/catalog/002/002-02.jpg',
      '/images/catalog/002/002-03.jpg',
      '/images/catalog/002/002-04.jpg',
      '/images/catalog/002/002-05.png',
      '/images/catalog/002/002-06.jpg',
    ],
    description:
      'Прекрасная и суровая, как северная природа, эта свеча согреет вас своим огнём и окутает дивным ароматом «Ты — первооткрыватель!». Немного шершавая текстурная поверхность дарит ощущение прикосновения к настоящему камню, а если загрузить аудиодорожку по QR-коду с открытки, погружение в природную стихию станет полным. 100% натуральный соевый воск раскрывает аромат наилучшим образом.',
    scent: ['Свежая трава', 'Бергамот', 'Эвкалипт', 'Пихта', 'Можжевельник', 'Тепло кожи', 'Пачули'],
    inStock: true,
    visibility: 'public',
    sale: null,
  },
  {
    slug: 'simfoniya-kamney-2-kub',
    name: 'Симфония камней №2 (куб)',
    series: 'Горы',
    category: 'Аромасвеча',
    subtitle: 'Тайна застывшей лавы',
    aroma: 'Дымная, мистическая композиция, которая пленяет и интригует.',
    tagline: 'Загадка, что оживает с огнём.',
    priceKopecks: 180000,
    image: '/images/catalog/003/003-01.png',
    images: [
      '/images/catalog/003/003-01.png',
      '/images/catalog/003/003-02.jpg',
      '/images/catalog/003/003-03.png',
      '/images/catalog/003/003-04.jpg',
      '/images/catalog/003/003-05.png',
    ],
    description:
      'Погрузитесь в мистическую атмосферу с ароматической свечой «Тайна застывшей лавы», созданной из соевого воска в гипсовом стакане, имитирующем остывшую лаву. Смелая композиция из нот перца, конопли и рома в сочетании с дымными аккордами сандалового дерева и землистыми пачули создаёт уникальный аромат, который пленяет и интригует. Камни обсидиана, украшающие свечу, добавляют особую силу и таинственность вашему пространству. Ощутите роскошь и загадочность с каждым зажжением.',
    scent: ['Перец', 'Конопля', 'Ром', 'Сандаловое дерево', 'Пачули'],
    inStock: true,
    visibility: 'public',
    sale: null,
  },
  {
    slug: 'simfoniya-kamney-3-cilindr',
    name: 'Симфония камней №3 (цилиндр)',
    series: 'Горы',
    category: 'Аромасвеча',
    subtitle: 'Тайна застывшей лавы',
    aroma: 'Дымная, мистическая композиция, которая пленяет и интригует.',
    tagline: 'Спокойная сила горной породы.',
    priceKopecks: 200000,
    image: '/images/catalog/004/004-01.png',
    images: [
      '/images/catalog/004/004-01.png',
      '/images/catalog/004/004-02.jpg',
      '/images/catalog/004/004-03.jpg',
      '/images/catalog/004/004-04.jpg',
      '/images/catalog/004/004-05.jpg',
    ],
    description:
      'Стройный цилиндр, словно базальтовый столб, рождённый застывшим лавовым потоком, — его строгая вертикаль приносит в дом спокойную силу горной породы. Внутри 100% натуральный соевый воск и тот же завораживающий аромат «Тайна застывшей лавы»: разогретый перец, дерзкая конопля и тёплый ром раскрываются на дымном сандаловом дереве и оседают землистыми пачули. Натуральные камни обсидиана хранят энергию вулкана и притягивают взгляд. Зажгите свечу и наполните пространство глубиной, теплом и благородной тайной.',
    scent: ['Перец', 'Конопля', 'Ром', 'Сандаловое дерево', 'Пачули'],
    inStock: true,
    visibility: 'public',
    sale: null,
  },
  {
    slug: 'morskoy-kamen',
    name: 'Морской камень',
    series: 'Горы',
    category: 'Свеча',
    subtitle: 'Море и камень',
    aroma: 'Лёгкий аромат свободы, свежести и скалистого берега.',
    tagline: 'Твоя личная гавань спокойствия.',
    priceKopecks: 90000,
    image: '/images/catalog/005/005-01.png',
    images: [
      '/images/catalog/005/005-01.png',
      '/images/catalog/005/005-02.jpg',
      '/images/catalog/005/005-03.png',
      '/images/catalog/005/005-04.png',
      '/images/catalog/005/005-05.jpg',
    ],
    description:
      'Морской камень — свеча в форме обточенного морем камня. Её гладкая, омытая водой поверхность приносит в дом спокойствие и гармонию, а тёплый свет огонька превращает её в личную гавань тишины. Вблизи она дарит лёгкий аромат «Море и камень» — морской бриз и обточенный волнами берег. Подарите себе или близким кусочек природы, который хранит в себе силу вечных приливов. Достойный декор для тех, кто ценит природные формы и медитативную простоту.',
    scent: ['Морская соль', 'Перец', 'Альдегиды', 'Смола лабданума', 'Зелёная трава', 'Фрезия', 'Кедр', 'Пачули'],
    inStock: true,
    visibility: 'public',
    sale: null,
  },
  {
    slug: 'gornaya-vershina',
    name: 'Горная вершина',
    series: 'Горы',
    category: 'Свеча',
    subtitle: 'Ты — первооткрыватель!',
    aroma: 'Аромат путешествий, свежего лесного воздуха и духа приключений.',
    tagline: 'Каждая вершина покоряется идущему.',
    priceKopecks: 80000,
    image: '/images/catalog/006/006-01.jpg',
    images: [
      '/images/catalog/006/006-01.jpg',
      '/images/catalog/006/006-02.png',
      '/images/catalog/006/006-03.jpg',
      '/images/catalog/006/006-04.png',
      '/images/catalog/006/006-05.jpg',
    ],
    description:
      'Удивительно реалистичная свеча «Горная вершина» — символ величия и мудрости, духовного роста и неизбежных достижений. Её рельеф повторяет очертания заснеженного пика, напоминая: каждая вершина покоряется тому, кто продолжает идти. Вблизи свеча дарит лёгкий аромат «Ты — первооткрыватель!» — свежесть высокогорных трав и дух приключений. Достойный подарок себе или тому, кто идёт к своей цели.',
    scent: ['Свежая трава', 'Бергамот', 'Эвкалипт', 'Пихта', 'Можжевельник', 'Тепло кожи', 'Пачули'],
    inStock: true,
    visibility: 'public',
    sale: null,
  },
]

export function getSeedProduct(slug: string): Product | undefined {
  return SEED_PRODUCTS.find((p) => p.slug === slug)
}

export function seedSlugs(): string[] {
  return SEED_PRODUCTS.map((p) => p.slug)
}
