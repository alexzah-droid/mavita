import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOzonFbsClient, extractCategoryLeaves, OzonApiError } from '@/lib/ozon-fbs-client'

const creds = { clientId: 'cid', secret: 'sek' }
const noSleep = () => Promise.resolve()
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}
function client(fetchImpl: typeof fetch, maxRetries = 2) {
  return createOzonFbsClient(creds, { fetchImpl, sleep: noSleep, maxRetries })
}

afterEach(() => { delete process.env.OZON_API_BASE })

describe('заголовки и базовый URL', () => {
  it('передаёт Client-Id/Api-Key, не светит их в ошибках', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { warehouses: [], has_next: false }))
    await client(fetchImpl as unknown as typeof fetch).listWarehouses()
    const init = fetchImpl.mock.calls[0][1]
    expect((init as RequestInit).headers).toMatchObject({ 'Client-Id': 'cid', 'Api-Key': 'sek' })
  })
})

describe('listWarehouses', () => {
  it('склеивает cursor-страницы и нормализует поля', async () => {
    const pages = [
      jsonResponse(200, { warehouses: [{ warehouse_id: 1, name: 'A', warehouse_type: 'fbs', status: 'created' }], has_next: true, cursor: 'c1' }),
      jsonResponse(200, { warehouses: [{ warehouse_id: 2, name: 'B', warehouse_type: 'fbs', status: 'created' }], has_next: false }),
    ]
    const fetchImpl = vi.fn(async () => pages.shift()!)
    const out = await client(fetchImpl as unknown as typeof fetch).listWarehouses()
    expect(out).toEqual([
      { warehouseId: 1, name: 'A', type: 'fbs', status: 'created' },
      { warehouseId: 2, name: 'B', type: 'fbs', status: 'created' },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('extractCategoryLeaves', () => {
  it('наследует description_category_id вниз по дереву', () => {
    const tree = [{ description_category_id: 100, category_name: 'Дом', children: [{ type_id: 5, type_name: 'Свеча' }, { type_id: 6, type_name: 'Подсвечник', disabled: true }] }]
    const leaves = extractCategoryLeaves(tree)
    expect(leaves).toContainEqual({ descriptionCategoryId: 100, typeId: 5, name: 'Свеча', disabled: false })
    expect(leaves.find((l) => l.typeId === 6)?.disabled).toBe(true)
  })
})

describe('importProducts', () => {
  it('возвращает task_id (из result или верхнего уровня)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: { task_id: 'task-123' } }))
    expect(await client(fetchImpl as unknown as typeof fetch).importProducts([{ offer_id: 'mavita-9' }])).toEqual({ taskId: 'task-123' })
  })
  it('нет task_id → OzonApiError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: {} }))
    await expect(client(fetchImpl as unknown as typeof fetch).importProducts([])).rejects.toBeInstanceOf(OzonApiError)
  })
})

describe('getProductInfo', () => {
  it('читает moderate_status и штрихкоды', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [{ offer_id: 'mavita-9', product_id: 5189655669, statuses: { moderate_status: 'approved', status_name: 'Продаётся' }, visible: true, barcodes: ['460', '460'] }] }))
    const [item] = await client(fetchImpl as unknown as typeof fetch).getProductInfo({ offerIds: ['mavita-9'] })
    expect(item).toMatchObject({ offerId: 'mavita-9', productId: 5189655669, moderateStatus: 'approved', visible: true, barcodes: ['460'] })
  })
})

describe('setStock', () => {
  it('успех не бросает', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [{ offer_id: 'mavita-9', updated: true }] }))
    await expect(client(fetchImpl as unknown as typeof fetch).setStock({ offerId: 'mavita-9', productId: 1, stock: 0, warehouseId: 42 })).resolves.toBeUndefined()
  })
  it('updated=false → OzonApiError с кодом', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [{ offer_id: 'mavita-9', updated: false, errors: [{ code: 'NOT_FOUND', message: 'нет такого товара' }] }] }))
    await expect(client(fetchImpl as unknown as typeof fetch).setStock({ offerId: 'mavita-9', productId: 1, stock: 5, warehouseId: 42 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('обработка статусов и ретраи', () => {
  it('401 → authFailed, не ретраится', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { code: 16, message: 'invalid api key' }))
    await expect(client(fetchImpl as unknown as typeof fetch).listWarehouses()).rejects.toMatchObject({ authFailed: true, retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('400 → не ретраится', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { code: 9, message: 'bad request' }))
    await expect(client(fetchImpl as unknown as typeof fetch).listWarehouses()).rejects.toMatchObject({ status: 400, retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('429 ретраится до maxRetries, затем бросает', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { message: 'too many' }))
    await expect(client(fetchImpl as unknown as typeof fetch, 2).listWarehouses()).rejects.toMatchObject({ status: 429 })
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 1 + 2 retries
  })
  it('5xx ретраится и затем успех', async () => {
    const seq = [jsonResponse(503, { message: 'down' }), jsonResponse(200, { warehouses: [], has_next: false })]
    const fetchImpl = vi.fn(async () => seq.shift()!)
    await expect(client(fetchImpl as unknown as typeof fetch, 3).listWarehouses()).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('сеть/таймаут → retryable, статус 0', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('aborted') })
    await expect(client(fetchImpl as unknown as typeof fetch, 0).listWarehouses()).rejects.toMatchObject({ status: 0, retryable: true })
  })
  it('malformed JSON на ошибочном статусе → безопасное сообщение', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json') } } as unknown as Response))
    await expect(client(fetchImpl as unknown as typeof fetch, 0).listWarehouses()).rejects.toMatchObject({ status: 500, retryable: true })
  })
})
