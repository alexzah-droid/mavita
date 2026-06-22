import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { assertSameOrigin, requireAdminApi } from '@/lib/auth'
import { withTransaction } from '@/lib/db'
import { detectImageType, imageDimensions } from '@/lib/upload-image'

const MAX_FILES = 10; const MAX_BYTES = 5 * 1024 * 1024; const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'products')
type Created = { id: number; filename: string; sortOrder: number; isCover: boolean }
function authOk(value: Awaited<ReturnType<typeof requireAdminApi>>): value is { isAdmin: true; loginAt: number } { return !(value instanceof NextResponse) }
export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!authOk(auth)) return auth; const csrf = assertSameOrigin(request); if (csrf) return csrf
  const form = await request.formData().catch(() => null); const id = Number(form?.get('productId')); const files = form?.getAll('files').filter((x): x is File => x instanceof File) ?? []
  if (!form || !Number.isInteger(id) || id < 1 || !files.length || files.length > MAX_FILES) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', messages: ['Нужны productId и от 1 до 10 файлов'] } }, { status: 400 })
  const prepared: { stage: string; final: string; filename: string }[] = []
  try {
    await mkdir(UPLOAD_DIR, { recursive: true })
    for (const file of files) {
      if (file.size > MAX_BYTES) throw new Error('Каждое фото не больше 5 MiB')
      const data = Buffer.from(await file.arrayBuffer()); const kind = detectImageType(data); if (!kind || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Поддерживаются JPEG, PNG и WebP')
      const dims = imageDimensions(data, kind.mime); if (!dims || dims[0] > 6000 || dims[1] > 6000 || dims[0] < 1 || dims[1] < 1) throw new Error('Нераспознаваемое изображение или размер больше 6000×6000')
      const name = `${randomUUID()}.${kind.ext}`; const stage = path.join(UPLOAD_DIR, `.${name}.upload`); const final = path.join(UPLOAD_DIR, name); await writeFile(stage, data); prepared.push({ stage, final, filename: `/uploads/products/${name}` })
    }
    const images = await withTransaction(async (client) => {
      // Блокировка строки товara — первый запрос транзакции. Та же строка lockается
      // в reorderProductImages/deleteProductImage (lib/admin-products-db.ts), что
      // сериализует все фото-операции и сохраняет инвариант единственной обложки.
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
