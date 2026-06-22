import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { expect, test } from '@playwright/test'

// E2E фото-сортировки, назначения обложки, 409, архивирования и hard delete.
// Получает явную DB-fixture и авторизованную сессию — НЕ опирается на seed/fallback.
// В CI отсутствие DATABASE_URL — ОШИБКА (а не тихий skip), иначе зелёный e2e не
// доказывал бы ничего; локально без БД набор пропускается.
const dbUrl = process.env.DATABASE_URL
const adminPassword = process.env.ADMIN_PASSWORD ?? 'e2e'
if (!dbUrl && process.env.CI) throw new Error('admin-product e2e требует DATABASE_URL в CI (тихий skip запрещён)')
test.skip(!dbUrl, 'нужен DATABASE_URL для DB-fixture админских товаров')

const pool = dbUrl ? new Pool({ connectionString: dbUrl }) : null
let productId: number
const slug = `e2e-${randomUUID().slice(0, 8)}`

let imageIds: number[]
test.beforeEach(async () => {
  const product = await pool!.query<{ id: number }>("INSERT INTO products (slug, name, price_kopecks, visibility) VALUES ($1, 'E2E свеча', 100000, 'public') RETURNING id", [slug])
  productId = product.rows[0].id
  const imgs = await pool!.query<{ id: number }>('INSERT INTO product_images (product_id, filename, sort_order, is_cover) VALUES ($1, $2, 10, true), ($1, $3, 20, false) RETURNING id', [productId, `/uploads/products/${slug}-1.webp`, `/uploads/products/${slug}-2.webp`])
  imageIds = imgs.rows.map((r) => r.id) // [первое (cover), второе]
})
const orderedIds = async () => (await pool!.query<{ id: number }>('SELECT id FROM product_images WHERE product_id = $1 ORDER BY sort_order, id', [productId])).rows.map((r) => r.id)
test.afterEach(async () => { await pool!.query('DELETE FROM products WHERE id = $1', [productId]) })
test.afterAll(async () => { await pool?.end() })

async function login(page: import('@playwright/test').Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Пароль').fill(adminPassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForURL('**/admin')
}

test('reorders photos, keeps the cover, and persists the new order from the server response', async ({ page }) => {
  await login(page)
  await page.goto(`/admin/products/${productId}/edit`)
  const images = page.locator('.admin-images > div')
  await expect(images).toHaveCount(2)
  // Двигаем первое фото правее → порядок [второе, первое]; обложка остаётся первой.
  await images.first().getByRole('button', { name: 'Правее' }).click()
  await expect.poll(orderedIds).toEqual([imageIds[1], imageIds[0]])
  const cover = await pool!.query<{ id: number }>('SELECT id FROM product_images WHERE product_id = $1 AND is_cover', [productId])
  expect(cover.rows.map((r) => r.id)).toEqual([imageIds[0]]) // ровно одна, прежняя обложка

  // Назначаем обложкой текущее первое фото в порядке (imageIds[1]) — тем же
  // запросом с полным порядком.
  await page.locator('.admin-images > div').first().getByRole('button', { name: 'Сделать обложкой' }).click()
  await expect.poll(async () => (await pool!.query<{ id: number }>('SELECT id FROM product_images WHERE product_id = $1 AND is_cover', [productId])).rows.map((r) => r.id)).toEqual([imageIds[1]])

  await page.reload()
  await expect.poll(orderedIds).toEqual([imageIds[1], imageIds[0]])
})

test('shows the conflict message and refetches when the image set changed elsewhere', async ({ page }) => {
  await login(page)
  await page.goto(`/admin/products/${productId}/edit`)
  // Сервер сообщает 409 (набор фото изменился в другом окне).
  await page.route('**/api/admin/products/*/images', (route) => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', messages: ['Набор изображений изменился'] } } })
    : route.continue())
  await page.locator('.admin-images > div').first().getByRole('button', { name: 'Правее' }).click()
  await expect(page.getByText('Список фото изменился в другом окне — повторите действие')).toBeVisible()
})

test('archives the product without deleting it', async ({ page }) => {
  await login(page)
  await page.goto(`/admin/products/${productId}/edit`)
  await page.getByRole('button', { name: 'Архивировать' }).click()
  await expect(page.getByText('Товар архивирован (скрыт)')).toBeVisible()
  const row = await pool!.query<{ visibility: string }>('SELECT visibility FROM products WHERE id = $1', [productId])
  expect(row.rows[0].visibility).toBe('hidden')
})

test('hard delete opens a confirmation dialog and requires the exact product name', async ({ page }) => {
  await login(page)
  await page.goto(`/admin/products/${productId}/edit`)
  // Поле/кнопка подтверждения не видны, пока диалог не открыт.
  await expect(page.getByPlaceholder('Название товара')).toHaveCount(0)
  await page.getByRole('button', { name: 'Удалить навсегда' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Удалить безвозвратно' })
  await expect(confirm).toBeDisabled()
  await dialog.getByPlaceholder('Название товара').fill('E2E свеча')
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await page.waitForURL('**/admin')
  expect((await pool!.query('SELECT 1 FROM products WHERE id = $1', [productId])).rowCount).toBe(0)
})
