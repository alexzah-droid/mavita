#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROD_HOST = process.env.MAVITA_PROD_SSH_HOST || 'mavita'
const SITE_URL = (process.env.MAVITA_PROD_URL || 'https://mavita.ru').replace(/\/+$/, '')
const OUTPUT_DIR = path.resolve(process.env.MAVITA_SNAPSHOT_DIR || process.env.INIT_CWD || process.cwd())
const GOODS_ONLY = process.argv.slice(2).includes('goods')
const XLSX = process.argv.slice(2).includes('xlsx')

const PRODUCT_FIELD_LABELS = {
  id: 'ID товара',
  slug: 'Slug',
  name: 'Название',
  series: 'Серия',
  subtitle: 'Подзаголовок',
  description: 'Описание',
  price_kopecks: 'Цена, ₽',
  scent: 'Ароматы',
  in_stock: 'В наличии',
  visibility: 'Витрина',
  sale_price_kopecks: 'Цена скидки, ₽',
  sale_starts_at: 'Начало скидки',
  sale_ends_at: 'Окончание скидки',
  sort_order: 'Порядок на витрине',
  created_at: 'Создан',
  updated_at: 'Обновлён',
  weight_grams: 'Вес изделия, г (витрина и СДЭК)',
  wax_weight: 'Вес чистого воска',
  burn_time_hours: 'Время горения, ч',
  wax: 'Состав воска',
  wick: 'Фитиль',
  box_length_cm: 'Коробка: длина, см',
  box_width_cm: 'Коробка: ширина, см',
  box_height_cm: 'Коробка: высота, см',
}

const SQL = String.raw`
SELECT json_build_object(
  'siteContent', (SELECT to_jsonb(site_content) FROM site_content WHERE singleton = true),
  'products', COALESCE((
    SELECT jsonb_agg(
      to_jsonb(p) || jsonb_build_object(
        'images', COALESCE((
          SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.sort_order, pi.id)
          FROM product_images pi WHERE pi.product_id = p.id
        ), '[]'::jsonb)
      ) ORDER BY p.sort_order, p.id
    ) FROM products p
  ), '[]'::jsonb)
)::text;
`.trim()

function moscowTimestamp(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow', year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} - ${parts.hour}-${parts.minute}-${parts.second}`
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? `&${entity};`
    const hex = entity[1].toLowerCase() === 'x'
    return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10))
  }).replace(/\u00a0/g, ' ')
}

function htmlToMarkdown(html) {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, '[$3]($2)')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim())
}

async function readPublishedPage(route) {
  const url = `${SITE_URL}${route}`
  const response = await fetch(url, {
    headers: { 'user-agent': 'mavita-production-snapshot/1.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const html = await response.text()
  const main = html.match(/<main\b[^>]*class=["'][^"']*\blegal-page\b[^"']*["'][^>]*>([\s\S]*?)<\/main>/i)
  if (!main) throw new Error(`${url}: не найден блок <main class="legal-page">`)
  return { url, markdown: htmlToMarkdown(main[1]) }
}

async function readProductionDatabase() {
  const encodedSql = Buffer.from(SQL, 'utf8').toString('base64')
  const remoteCommand =
    `printf '%s' '${encodedSql}' | base64 -d | sudo -u postgres psql -d mavita -X --no-psqlrc -qAt -v ON_ERROR_STOP=1`
  const { stdout } = await execFileAsync('ssh', [PROD_HOST, remoteCommand], {
    maxBuffer: 20 * 1024 * 1024, timeout: 60_000,
  })
  const raw = stdout.trim()
  if (!raw) throw new Error('Production-БД вернула пустой ответ')
  return JSON.parse(raw)
}

function value(fieldValue) {
  if (fieldValue === null || fieldValue === undefined) return '—'
  if (typeof fieldValue === 'boolean') return fieldValue ? 'да' : 'нет'
  if (Array.isArray(fieldValue)) return fieldValue.length ? fieldValue.join(' · ') : '—'
  if (typeof fieldValue === 'object') return `\`${JSON.stringify(fieldValue)}\``
  return String(fieldValue) || '—'
}

function productStatus(visibility) {
  return { public: 'опубликована', unlisted: 'по ссылке', hidden: 'скрыта' }[visibility]
    || `неизвестно (${visibility})`
}

function productFieldValue(key, fieldValue) {
  if ((key === 'price_kopecks' || key === 'sale_price_kopecks') && typeof fieldValue === 'number') {
    return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(fieldValue / 100)} ₽`
  }
  if (key === 'visibility' && typeof fieldValue === 'string') return productStatus(fieldValue)
  return value(fieldValue)
}

function excelValue(key, fieldValue) {
  if (fieldValue === null || fieldValue === undefined) return null
  if (key === 'price_kopecks' || key === 'sale_price_kopecks') return fieldValue / 100
  if (key === 'visibility') return productStatus(fieldValue)
  if (Array.isArray(fieldValue)) return fieldValue.join(' · ')
  if (typeof fieldValue === 'object') return JSON.stringify(fieldValue)
  if (key.endsWith('_at') && typeof fieldValue === 'string') {
    const date = new Date(fieldValue)
    if (!Number.isNaN(date.getTime())) return date
  }
  return fieldValue
}

function styleWorksheet(sheet, headerRow = 1) {
  sheet.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }]
  const header = sheet.getRow(headerRow)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF514538' } }
  header.alignment = { vertical: 'middle', wrapText: true }
  header.height = 30
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: sheet.columnCount } }
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber !== headerRow) {
      row.alignment = { vertical: 'top', wrapText: true }
      if (rowNumber % 2 === 1) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F3EE' } }
      }
    }
  })
  sheet.columns.forEach((column) => {
    let width = 12
    column.eachCell({ includeEmpty: false }, (cell) => {
      width = Math.max(width, Math.min(45, String(cell.value ?? '').length + 2))
    })
    column.width = width
  })
}

function addTextSheet(workbook, name, sourceUrl, markdown) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = [{ header: 'Раздел', key: 'section' }, { header: 'Текст', key: 'text' }, { header: 'Источник', key: 'source' }]
  let section = name
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      section = heading[1]
      continue
    }
    sheet.addRow({ section, text: line.replace(/^-\s+/, ''), source: sourceUrl })
  }
  styleWorksheet(sheet)
  sheet.getColumn('text').width = 80
  sheet.getColumn('source').width = 32
}

export async function writeXlsx(outputPath, generatedAt, database, pages) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'МАВИТА production snapshot'
  workbook.created = generatedAt
  workbook.modified = generatedAt

  const info = workbook.addWorksheet('Сведения')
  info.addRows([
    ['Параметр', 'Значение'],
    ['Дата генерации', generatedAt],
    ['Часовой пояс', 'Europe/Moscow'],
    ['Production', SITE_URL],
    ['Режим', GOODS_ONLY ? 'Только товары' : 'Полный срез'],
    ['Количество товаров', database.products.length],
  ])
  info.getCell('B2').numFmt = 'yyyy-mm-dd hh:mm:ss'
  styleWorksheet(info)
  info.getColumn(1).width = 28
  info.getColumn(2).width = 50

  const productKeys = [...new Set(database.products.flatMap((product) =>
    Object.keys(product).filter((key) => key !== 'images'),
  ))]
  const products = workbook.addWorksheet('Товары')
  products.columns = productKeys.map((key) => ({
    header: `${PRODUCT_FIELD_LABELS[key] || key} (${key})`,
    key,
  }))
  for (const product of database.products) {
    products.addRow(Object.fromEntries(productKeys.map((key) => [key, excelValue(key, product[key])])))
  }
  styleWorksheet(products)
  for (const key of ['price_kopecks', 'sale_price_kopecks']) {
    const column = products.getColumn(key)
    if (column) column.numFmt = '#,##0.00 [$₽-ru-RU]'
  }
  for (const key of productKeys.filter((key) => key.endsWith('_at'))) {
    products.getColumn(key).numFmt = 'yyyy-mm-dd hh:mm:ss'
  }
  for (const key of ['description', 'scent']) {
    if (productKeys.includes(key)) products.getColumn(key).width = 45
  }

  const images = workbook.addWorksheet('Изображения')
  images.columns = [
    { header: 'ID товара', key: 'product_id' },
    { header: 'Название товара', key: 'product_name' },
    { header: 'Slug', key: 'product_slug' },
    { header: 'ID изображения', key: 'id' },
    { header: 'Файл', key: 'filename' },
    { header: 'Порядок', key: 'sort_order' },
    { header: 'Обложка', key: 'is_cover' },
  ]
  for (const product of database.products) {
    for (const image of product.images || []) {
      images.addRow({ product_id: product.id, product_name: product.name, product_slug: product.slug, ...image })
    }
  }
  styleWorksheet(images)
  images.getColumn('filename').width = 55

  if (!GOODS_ONLY) {
    const content = workbook.addWorksheet('Контент')
    content.columns = [
      { header: 'Раздел', key: 'section' },
      { header: 'Поле', key: 'field' },
      { header: 'Значение', key: 'value' },
      { header: 'Обновлено', key: 'updated_at' },
    ]
    const siteContent = database.siteContent
    if (siteContent) {
      content.addRow({ section: 'О бренде', field: 'Текст', value: siteContent.about_text, updated_at: new Date(siteContent.updated_at) })
      const names = { gory: 'Горы', more: 'Море', les: 'Лес' }
      for (const [key, name] of Object.entries(names)) {
        for (const [field, fieldValue] of Object.entries(siteContent.stihii?.[key] || {})) {
          content.addRow({ section: `Три стихии — ${name}`, field, value: fieldValue, updated_at: new Date(siteContent.updated_at) })
        }
      }
    }
    styleWorksheet(content)
    content.getColumn('value').width = 80
    content.getColumn('updated_at').numFmt = 'yyyy-mm-dd hh:mm:ss'
    addTextSheet(workbook, 'Оферта', pages[0].url, pages[0].markdown)
    addTextSheet(workbook, 'Доставка', pages[1].url, pages[1].markdown)
  }

  await workbook.xlsx.writeFile(outputPath)
}

function renderSiteContent(siteContent) {
  if (!siteContent) return '_Запись site_content отсутствует в production-БД._'
  const names = { gory: 'Горы', more: 'Море', les: 'Лес' }
  const tiles = Object.entries(names).map(([key, name]) => {
    const tile = siteContent.stihii?.[key] || {}
    return `### ${name}\n\n- Состояние: ${value(tile.state)}\n- Описание: ${value(tile.desc)}\n- Ароматы: ${value(tile.scents)}`
  }).join('\n\n')
  return `## О бренде\n\n${siteContent.about_text}\n\n_Обновлено: ${value(siteContent.updated_at)}_\n\n## Три стихии\n\n${tiles}`
}

function renderProducts(products) {
  if (!products.length) return '_Товары в production-БД отсутствуют._'
  return products.map((product) => {
    const { images = [], ...attributes } = product
    const rows = Object.entries(attributes).map(([key, fieldValue]) =>
      `| ${PRODUCT_FIELD_LABELS[key] || key} | \`${key}\` | ${productFieldValue(key, fieldValue).replace(/\|/g, '\\|').replace(/\n+/g, '<br>')} |`,
    ).join('\n')
    const imageRows = images.length
      ? images.map((image) =>
        `| ${image.id} | ${image.filename.replace(/\|/g, '\\|')} | ${image.sort_order} | ${image.is_cover ? 'да' : 'нет'} |`,
      ).join('\n')
      : '| — | Изображений нет | — | — |'
    return `## ${product.name} (\`${product.slug}\`)\n\n**Состояние карточки:** ${productStatus(product.visibility)}\n\n**Ссылка:** ${SITE_URL}/product/${product.slug}\n\n| Поле в интерфейсе | Атрибут БД | Фактическое значение |\n| --- | --- | --- |\n${rows}\n\n### Изображения\n\n| ID | Файл | Порядок | Обложка |\n| --- | --- | ---: | --- |\n${imageRows}`
  }).join('\n\n---\n\n')
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Создаёт Markdown- или Excel-срез production-данных МАВИТА.

Использование:
  npm --prefix shop run snapshot:production
  npm --prefix shop run snapshot:production -- goods
  npm --prefix shop run snapshot:production -- xlsx
  npm --prefix shop run snapshot:production -- goods xlsx

Аргумент goods создаёт срез только со сведениями о товарах.
Аргумент xlsx создаёт Excel-файл вместо Markdown.

Переменные окружения:
  MAVITA_PROD_SSH_HOST  SSH alias (по умолчанию: mavita)
  MAVITA_PROD_URL       URL сайта (по умолчанию: https://mavita.ru)
  MAVITA_SNAPSHOT_DIR   каталог результата (по умолчанию: каталог запуска npm)`)
    return
  }

  const generatedAt = new Date()
  const stamp = moscowTimestamp(generatedAt)
  const outputPath = path.join(OUTPUT_DIR, `срез данных Мавита от ${stamp}.${XLSX ? 'xlsx' : 'md'}`)
  const database = await readProductionDatabase()
  const pages = GOODS_ONLY
    ? null
    : await Promise.all([readPublishedPage('/offer'), readPublishedPage('/delivery')])
  const commonHeader = `# Срез данных МАВИТА

- Дата генерации: ${generatedAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (Europe/Moscow)
- Production: ${SITE_URL}
- Режим: ${GOODS_ONLY ? 'только товары' : 'полный срез'}
`
  const productsSection = `# Товары

Всего товаров: ${database.products.length}

${renderProducts(database.products)}
`
  await mkdir(OUTPUT_DIR, { recursive: true })
  if (XLSX) {
    await writeXlsx(outputPath, generatedAt, database, pages)
    console.log(outputPath)
    return
  }
  const markdown = GOODS_ONLY ? `${commonHeader}
${productsSection}` : `${commonHeader}
- Источник товаров и редактируемых разделов: production-БД
- Источник отдельных страниц: опубликованный HTML сайта

# Редактируемые разделы

${renderSiteContent(database.siteContent)}

# Страница «Оферта»

Источник: ${pages[0].url}

${pages[0].markdown}

# Страница «Доставка»

Источник: ${pages[1].url}

${pages[1].markdown}

${productsSection}
`
  await writeFile(outputPath, markdown, { encoding: 'utf8', flag: 'wx' })
  console.log(outputPath)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Не удалось создать срез: ${error.message}`)
    process.exitCode = 1
  })
}
