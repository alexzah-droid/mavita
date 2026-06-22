import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createTestSchema, type SchemaHandle } from '@/test/integration-db'

// Интеграционный тест FBS-каталога против реального PostgreSQL (схема из schema.sql,
// которая включает миграции 010/011). Проверяет constraints профиля, lease/fencing
// очереди и полный жизненный цикл карточки через worker с ПОДДЕЛЬНЫМ Ozon-клиентом
// (живой ключ не нужен). Запускается под `npm run test:integration` с TEST_DATABASE_URL.

let handle: SchemaHandle
let db: typeof import('@/lib/db')
let sync: typeof import('@/lib/ozon-fbs-sync')
let profileLib: typeof import('@/lib/ozon-fbs-profile')

beforeAll(async () => {
  handle = await createTestSchema()
  process.env.DATABASE_URL = handle.dbUrl
  process.env.NEXT_PUBLIC_BASE_URL = 'https://mavita.ru'
  process.env.OZON_CATALOG_SYNC_ENABLED = 'true'
  db = await import('@/lib/db')
  sync = await import('@/lib/ozon-fbs-sync')
  profileLib = await import('@/lib/ozon-fbs-profile')
})
afterAll(async () => { await handle?.drop(); delete process.env.OZON_CATALOG_SYNC_ENABLED })
beforeEach(async () => { await db.query('DELETE FROM ozon_product_profiles'); await db.query('DELETE FROM products') })

async function seedReadyProduct(): Promise<number> {
  const id = (await db.query<{ id: number }>("INSERT INTO products (slug, name, description, price_kopecks) VALUES ('mk', 'Морской камень', 'Описание', 90000) RETURNING id"))[0].id
  await db.query("INSERT INTO product_images (product_id, filename, sort_order, is_cover) VALUES ($1, '005/005-01.png', 0, true)", [id])
  await profileLib.updateOzonProfileFields(id, {
    enabled: true, fbsStockQuantity: 7, descriptionCategoryId: 17028739, typeId: 95741, weightGrams: 1000, lengthMm: 120, widthMm: 120, heightMm: 120,
    attributes: [{ attributeId: 85, complexId: 0, values: [{ dictionaryValueId: 1 }] }], complianceStatus: 'ready',
  })
  return id
}

// Поддельный Ozon-клиент: фиксирует вызовы, эхо-offer_id из import, управляемые статусы.
function fakeClient(state: { visible: boolean; moderate: string }) {
  const calls: { method: string; args: unknown }[] = []
  let lastOffer = 'mavita-0'
  const productId = 555
  return {
    calls,
    client: {
      listWarehouses: async () => [{ warehouseId: 42, name: 'W', type: 'fbs', status: 'created' }],
      findWarehouse: async () => ({ warehouseId: 42, name: 'W', type: 'fbs', status: 'created' }),
      listCategoryLeaves: async () => [],
      listCategoryAttributes: async () => [{ id: 85, complexId: 0, name: 'Бренд', type: null, isRequired: true, isCollection: false, dictionaryId: 1, maxValueCount: null }],
      listAttributeValues: async () => ({ values: [], hasNext: false }),
      importProducts: async (items: { offer_id: string }[]) => { lastOffer = items[0].offer_id; calls.push({ method: 'import', args: items }); return { taskId: 'task-1' } },
      getImportInfo: async () => [{ offerId: lastOffer, productId, status: 'imported', errors: [] }],
      getProductInfo: async () => [{ offerId: lastOffer, productId, moderateStatus: state.moderate, statusName: null, visible: state.visible, barcodes: ['BAR-AUTO'] }],
      setStock: async (p: unknown) => { calls.push({ method: 'setStock', args: p }) },
    },
  }
}
function deps(client: ReturnType<typeof fakeClient>['client']): import('@/lib/ozon-fbs-sync').WorkerDeps {
  return { loadCredentials: async () => ({ clientId: 'c', secret: 's' }), loadWarehouseId: async () => 42, baseUrl: () => 'https://mavita.ru', makeClient: () => client as never, requiredAttributeIds: async () => [85], sleep: async () => {} }
}

describe('constraints профиля (миграция 010)', () => {
  it('default fbs_stock_quantity = 0 и offer_id уникален', async () => {
    const id = (await db.query<{ id: number }>("INSERT INTO products (slug, name, price_kopecks) VALUES ('a', 'A', 1) RETURNING id"))[0].id
    await profileLib.ensureOzonProfile(id)
    const p = await profileLib.getOzonProfile(id)
    expect(p?.fbsStockQuantity).toBe(0); expect(p?.offerId).toBe(`mavita-${id}`)
    await expect(db.query("INSERT INTO ozon_product_profiles (product_id, offer_id) VALUES ($1, $2)", [id, `mavita-${id}`])).rejects.toBeTruthy()
  })
  it('отрицательный остаток отклоняется БД', async () => {
    const id = (await db.query<{ id: number }>("INSERT INTO products (slug, name, price_kopecks) VALUES ('b', 'B', 1) RETURNING id"))[0].id
    await expect(db.query("INSERT INTO ozon_product_profiles (product_id, offer_id, fbs_stock_quantity) VALUES ($1, 'mavita-x', -1)", [id])).rejects.toBeTruthy()
  })
  it('категория — пара (один без второго запрещён)', async () => {
    const id = (await db.query<{ id: number }>("INSERT INTO products (slug, name, price_kopecks) VALUES ('c', 'C', 1) RETURNING id"))[0].id
    await expect(db.query("INSERT INTO ozon_product_profiles (product_id, offer_id, description_category_id) VALUES ($1, 'mavita-c', 5)", [id])).rejects.toBeTruthy()
  })
  it('удаление товара каскадит профиль', async () => {
    const id = await seedReadyProduct()
    await db.query('DELETE FROM products WHERE id = $1', [id])
    expect(await profileLib.getOzonProfile(id)).toBeUndefined()
  })
})

describe('полный жизненный цикл через worker', () => {
  it('import → awaiting_moderation с остатком 0, штрихкод сохранён, без ненулевого stock', async () => {
    const id = await seedReadyProduct()
    const fake = fakeClient({ visible: true, moderate: 'pending' })
    const { runId } = await sync.enqueueRun({ kind: 'single', operation: 'content_import', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(runId, deps(fake.client))
    const p = await profileLib.getOzonProfile(id)
    expect(p?.remoteState).toBe('awaiting_moderation'); expect(p?.ozonProductId).toBe(555); expect(p?.lastStockSentQuantity).toBe(0)
    expect(p?.barcode).toBe('BAR-AUTO') // авто-сгенерированный штрихкод сохранён для re-import
    // setStock вызван РОВНО для остатка 0 (гарантия нулевого остатка новой карточки).
    const stockCalls = fake.calls.filter((c) => c.method === 'setStock')
    expect(stockCalls.length).toBe(1)
    expect((stockCalls[0].args as { stock: number }).stock).toBe(0)
  })

  it('moderation_poll(MODERATED) → awaiting_manual_hide; ненулевой stock до подтверждения невозможен', async () => {
    const id = await seedReadyProduct()
    const fakePending = fakeClient({ visible: true, moderate: 'pending' })
    let r = await sync.enqueueRun({ kind: 'single', operation: 'content_import', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fakePending.client))

    // Попытка stock_update до подтверждения скрытия — позиция skip.
    r = await sync.enqueueRun({ kind: 'single', operation: 'stock_update', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fakePending.client))
    expect((await sync.listRunItems(r.runId))[0].status).toBe('skipped')

    // Модерация одобрена.
    const fakeApproved = fakeClient({ visible: false, moderate: 'moderated' })
    r = await sync.enqueueRun({ kind: 'single', operation: 'moderation_poll', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fakeApproved.client))
    expect((await profileLib.getOzonProfile(id))?.remoteState).toBe('awaiting_manual_hide')
  })

  it('confirm → hidden_confirmed → stock_update пишет остаток и метод api', async () => {
    const id = await seedReadyProduct()
    const fakeApproved = fakeClient({ visible: false, moderate: 'moderated' })
    let r = await sync.enqueueRun({ kind: 'single', operation: 'content_import', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fakeApproved.client))
    r = await sync.enqueueRun({ kind: 'single', operation: 'moderation_poll', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fakeApproved.client))

    // Подтверждение скрытия (как делает confirm-hidden endpoint).
    await db.query("UPDATE ozon_product_profiles SET remote_state = 'hidden_confirmed', manual_hidden_confirmed_at = now(), manual_hidden_confirmed_by_login_at = 1, stock_dirty = true WHERE product_id = $1", [id])

    r = await sync.enqueueRun({ kind: 'single', operation: 'stock_update', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fakeApproved.client))
    const p = await profileLib.getOzonProfile(id)
    expect(p?.lastStockSentQuantity).toBe(7); expect(p?.hiddenVerificationMethod).toBe('api'); expect(p?.stockDirty).toBe(false)
  })

  it('видимая на витрине карточка → ненулевой stock отклонён (api-признак)', async () => {
    const id = await seedReadyProduct()
    const fake = fakeClient({ visible: true, moderate: 'moderated' })
    let r = await sync.enqueueRun({ kind: 'single', operation: 'content_import', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fake.client))
    await db.query("UPDATE ozon_product_profiles SET remote_state = 'hidden_confirmed', manual_hidden_confirmed_at = now(), manual_hidden_confirmed_by_login_at = 1, stock_dirty = true WHERE product_id = $1", [id])
    r = await sync.enqueueRun({ kind: 'single', operation: 'stock_update', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fake.client))
    const items = await sync.listRunItems(r.runId)
    expect(items[0].status).toBe('failed')
    expect((await profileLib.getOzonProfile(id))?.lastStockSentQuantity).toBe(0)
  })

  it('dark-gate: при OZON_CATALOG_SYNC_ENABLED=false мутационный run не зовёт Ozon', async () => {
    const id = await seedReadyProduct()
    process.env.OZON_CATALOG_SYNC_ENABLED = 'false'
    const fake = fakeClient({ visible: true, moderate: 'pending' })
    const r = await sync.enqueueRun({ kind: 'single', operation: 'content_import', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    await sync.processRun(r.runId, deps(fake.client))
    process.env.OZON_CATALOG_SYNC_ENABLED = 'true'
    expect(fake.calls.length).toBe(0)
    expect((await sync.listRunItems(r.runId))[0].status).toBe('skipped')
  })

  it('содержательное изменение товара сбрасывает подтверждение скрытия (триггер 012)', async () => {
    const id = await seedReadyProduct()
    await db.query("UPDATE ozon_product_profiles SET remote_state = 'hidden_confirmed', ozon_product_id = 555, manual_hidden_confirmed_at = now(), hidden_verified_at = now(), hidden_verification_method = 'api', content_dirty = false, stock_dirty = false WHERE product_id = $1", [id])
    await db.query("UPDATE products SET name = 'Новое имя' WHERE id = $1", [id])
    const p = await profileLib.getOzonProfile(id)
    expect(p?.manualHiddenConfirmedAt).toBeNull(); expect(p?.hiddenVerifiedAt).toBeNull()
    expect(p?.contentDirty).toBe(true); expect(p?.stockDirty).toBe(true)
  })

  it('singleton worker-lock: занятый лок → processQueuedRuns busy, без исполнения', async () => {
    const id = await seedReadyProduct()
    await sync.enqueueRun({ kind: 'single', operation: 'content_import', warehouseId: 42, actorLoginAt: 1, productIds: [id] })
    const holder = new Pool({ connectionString: handle.dbUrl })
    try {
      await holder.query('SELECT pg_advisory_lock($1::bigint)', [sync.OZON_CATALOG_WORKER_LOCK])
      const fake = fakeClient({ visible: false, moderate: 'moderated' })
      const result = await sync.processQueuedRuns(deps(fake.client))
      expect(result.busy).toBe(true); expect(result.runs).toEqual([])
      expect(fake.calls.length).toBe(0) // ни один HTTP не ушёл
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1::bigint)', [sync.OZON_CATALOG_WORKER_LOCK])
      await holder.end()
    }
  })
})
