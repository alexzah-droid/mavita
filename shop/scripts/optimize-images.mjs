/**
 * Оптимизирует все изображения в public/images/:
 * - ресайзит до max 1600px по длинной стороне
 * - JPEG качество 85
 * - PNG-фотографии → JPEG (удаляет оригинальный .png)
 * - Пропускает логотип (logo.png — у него прозрачность)
 *
 * Запуск: node scripts/optimize-images.mjs
 */

import sharp from 'sharp'
import { readdir, rm, stat } from 'fs/promises'
import { join, extname, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', 'public', 'images')
const MAX_SIZE = 1600
const JPEG_QUALITY = 85

// PNG-файлы с прозрачностью — оставляем как есть
const KEEP_AS_PNG = new Set(['logo.png'])

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

async function processFile(filePath) {
  const ext = extname(filePath).toLowerCase()
  const name = basename(filePath)

  if (!['.jpg', '.jpeg', '.png'].includes(ext)) return
  if (KEEP_AS_PNG.has(name)) {
    console.log(`  skip  ${name} (логотип с прозрачностью)`)
    return
  }

  const isPng = ext === '.png'
  // PNG-фото → JPEG (меняем расширение)
  const outPath = isPng
    ? join(dirname(filePath), basename(filePath, ext) + '.jpg')
    : filePath

  const { size: sizeBefore } = await stat(filePath)

  const img = sharp(filePath)
  const meta = await img.metadata()
  const { width = 0, height = 0 } = meta

  const needsResize = width > MAX_SIZE || height > MAX_SIZE
  let pipeline = img

  if (needsResize) {
    pipeline = pipeline.resize({
      width: MAX_SIZE,
      height: MAX_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, progressive: true })

  // Пишем во временный файл, потом переименовываем (atomic on same fs)
  const tmpPath = outPath + '.tmp'
  await pipeline.toFile(tmpPath)

  const { size: sizeAfter } = await stat(tmpPath)
  const saved = ((1 - sizeAfter / sizeBefore) * 100).toFixed(0)

  // Удаляем оригинал (особенно важно если PNG → JPG, чтобы убрать .png)
  await rm(filePath)
  // Переименовываем tmp → целевой
  await import('fs/promises').then(m => m.rename(tmpPath, outPath))

  const dim = needsResize ? `${width}x${height}→${MAX_SIZE}` : `${width}x${height}`
  const tag = isPng ? 'png→jpg' : 'jpg'
  console.log(`  ${tag.padEnd(7)} ${dim.padEnd(18)} -${saved}%  ${basename(outPath)}`)
}

async function main() {
  console.log(`Оптимизируем изображения в ${ROOT}\n`)
  let count = 0
  for await (const file of walk(ROOT)) {
    await processFile(file)
    count++
  }
  console.log(`\nГотово. Обработано файлов: ${count}`)
}

main().catch(err => { console.error(err); process.exit(1) })
