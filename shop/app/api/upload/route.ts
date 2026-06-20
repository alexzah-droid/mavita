import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { withTransaction } from '@/lib/db'

const MAX_FILES = 10; const MAX_BYTES = 5 * 1024 * 1024; const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'products')
type Created = { id: number; filename: string; sortOrder: number; isCover: boolean }
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
function imageType(data: Buffer): { ext: string; mime: string } | null {
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { ext: 'jpg', mime: 'image/jpeg' }
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { ext: 'png', mime: 'image/png' }
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
  return null
}
function imageDimensions(data: Buffer, mime: string): [number, number] | null {
  if (mime === 'image/png' && data.length >= 24) return [data.readUInt32BE(16), data.readUInt32BE(20)]
  if (mime === 'image/webp' && data.length >= 30) {
    const kind = data.subarray(12, 16).toString(); if (kind === 'VP8X') return [1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3)]
  }
  if (mime === 'image/jpeg') for (let i = 2; i + 9 < data.length;) { if (data[i] !== 0xff) { i++; continue }; const marker = data[i + 1]; const length = data.readUInt16BE(i + 2); if (marker >= 0xc0 && marker <= 0xc3) return [data.readUInt16BE(i + 7), data.readUInt16BE(i + 5)]; i += 2 + length }
  return null
}
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf
  const form = await request.formData().catch(() => null); const id = Number(form?.get('productId')); const files = form?.getAll('files').filter((x): x is File => x instanceof File) ?? []
  if (!form || !Number.isInteger(id) || id < 1 || !files.length || files.length > MAX_FILES) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Нужны productId и от 1 до 10 файлов'] } }, { status: 400 })
  const prepared: { stage: string; final: string; filename: string }[] = []
  try {
    await mkdir(UPLOAD_DIR, { recursive: true })
    for (const file of files) {
      if (file.size > MAX_BYTES) throw new Error('Каждое фото не больше 5 MiB')
      const data = Buffer.from(await file.arrayBuffer()); const kind = imageType(data); if (!kind || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Поддерживаются JPEG, PNG и WebP')
      const dims = imageDimensions(data, kind.mime); if (!dims || dims[0] > 6000 || dims[1] > 6000 || dims[0] < 1 || dims[1] < 1) throw new Error('Нераспознаваемое изображение или размер больше 6000×6000')
      const name = `${randomUUID()}.${kind.ext}`; const stage = path.join(UPLOAD_DIR, `.${name}.upload`); const final = path.join(UPLOAD_DIR, name); await writeFile(stage, data); prepared.push({ stage, final, filename: `/uploads/products/${name}` })
    }
    const images = await withTransaction(async (client) => {
      const product = await client.query<{ id: number }>('SELECT id FROM products WHERE id = $1 FOR UPDATE', [id]); if (!product.rows[0]) throw new Error('NOT_FOUND')
      const count = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM product_images WHERE product_id = $1 FOR UPDATE', [id]); if (Number(count.rows[0].count) + prepared.length > MAX_FILES) throw new Error('У товара может быть до 10 фотографий')
      const existing = Number(count.rows[0].count); const created: Created[] = []
      for (const [index, file] of prepared.entries()) {
        const result = await client.query<Created>(`INSERT INTO product_images (product_id, filename, sort_order, is_cover) VALUES ($1, $2, $3, $4) RETURNING id, filename, sort_order AS "sortOrder", is_cover AS "isCover"`, [id, file.filename, (existing + index + 1) * 10, existing === 0 && index === 0])
        created.push(result.rows[0]); await rename(file.stage, file.final)
      }
      return created
    })
    return NextResponse.json({ images }, { status: 201 })
  } catch (err) {
    await Promise.all(prepared.flatMap((file) => [unlink(file.stage).catch(() => undefined), unlink(file.final).catch(() => undefined)]))
    const message = (err as Error).message
    return NextResponse.json({ error: { code: message === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR', messages: [message === 'NOT_FOUND' ? 'Товар не найден' : message] } }, { status: message === 'NOT_FOUND' ? 404 : 400 })
  }
}
