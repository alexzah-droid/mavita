// HTTP-клиент Seller API для FBS-каталога. Версии методов взяты из живого discovery
// (см. docs/specs/ozon-fbs-catalog-sync.md): warehouse — только /v2/warehouse/list
// с cursor-пагинацией; категории — /v1/description-category/*; продукт read —
// /v3/product/list, /v3/product/info/list; import — /v3/product/import (+import/info);
// остатки — /v2/products/stocks. Видимость (visibility/set) НЕ вызывается (метод
// залочен программой). Секреты (Api-Key/Client-Id) никогда не логируются и не
// попадают в сообщения об ошибках. Все HTTP полностью мокаются в unit-тестах.
import type { DeliveryCredentials } from '@/lib/delivery/types'

export type OzonClientOptions = {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  timeoutMs?: number
}

/** Безопасная ошибка вызова Ozon: без ключей, заголовков и сырых payload. */
export class OzonApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly retryable: boolean
  readonly authFailed: boolean
  constructor(message: string, opts: { status: number; code?: string | null; retryable: boolean; authFailed: boolean }) {
    super(message)
    this.name = 'OzonApiError'
    this.status = opts.status
    this.code = opts.code ?? null
    this.retryable = opts.retryable
    this.authFailed = opts.authFailed
  }
}

function baseUrl(): string { return (process.env.OZON_API_BASE || 'https://api-seller.ozon.ru').replace(/\/$/, '') }
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function str(value: unknown): string | null { return typeof value === 'string' && value.length ? value : null }
function num(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null }

export type FbsWarehouse = { warehouseId: number; name: string; type: string | null; status: string | null }
export type CategoryLeaf = { descriptionCategoryId: number; typeId: number; name: string; disabled: boolean }
export type CategoryAttribute = { id: number; complexId: number; name: string; type: string | null; isRequired: boolean; isCollection: boolean; dictionaryId: number; maxValueCount: number | null }
export type AttributeValue = { id: number; value: string }
export type ImportInfoItem = { offerId: string; productId: number | null; status: string | null; errors: string[] }
export type ProductInfoItem = { offerId: string | null; productId: number | null; moderateStatus: string | null; statusName: string | null; visible: boolean | null; barcodes: string[] }

/** Распознать дерево категорий в список leaf-типов (пара description_category_id + type_id). */
export function extractCategoryLeaves(tree: unknown, inheritedCategoryId?: number, inheritedDisabled = false): CategoryLeaf[] {
  const result: CategoryLeaf[] = []
  for (const item of array(tree)) {
    const node = object(item)
    if (!node) continue
    const ownCategory = Number(node.description_category_id)
    const category = Number.isSafeInteger(ownCategory) ? ownCategory : inheritedCategoryId
    const type = Number(node.type_id)
    const disabled = inheritedDisabled || node.disabled === true
    if (category !== undefined && Number.isSafeInteger(type)) {
      result.push({ descriptionCategoryId: category, typeId: type, name: String(node.type_name ?? node.category_name ?? ''), disabled })
    }
    result.push(...extractCategoryLeaves(node.children, category, disabled))
  }
  return result
}

export function createOzonFbsClient(creds: DeliveryCredentials, opts: OzonClientOptions = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const timeoutMs = opts.timeoutMs ?? 30_000
  const headers = { 'Client-Id': creds.clientId, 'Api-Key': creds.secret, 'Content-Type': 'application/json' }

  async function rawCall(path: string, body: unknown): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl()}${path}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers, body: JSON.stringify(body) })
    } catch {
      throw new OzonApiError('Ozon недоступен (сеть/таймаут)', { status: 0, retryable: true, authFailed: false })
    }
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const root = object(data)
      const code = root?.code != null ? String(root.code) : null
      const message = typeof root?.message === 'string' ? root.message.slice(0, 300) : `Ozon вернул ${response.status}`
      const authFailed = response.status === 401 || response.status === 403
      const retryable = response.status === 429 || response.status >= 500
      throw new OzonApiError(message, { status: response.status, code, retryable, authFailed })
    }
    return object(data) ?? {}
  }

  // Повтор только для сетевых и 429/5xx ошибок, с экспоненциальным backoff. 429 не
  // ретраится мгновенно. 4xx (включая 401/403) не ретраятся.
  async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
    let attempt = 0
    for (;;) {
      try {
        return await rawCall(path, body)
      } catch (error) {
        if (!(error instanceof OzonApiError) || !error.retryable || attempt >= maxRetries) throw error
        await sleep(Math.min(2000 * 2 ** attempt, 15_000))
        attempt += 1
      }
    }
  }

  return {
    /** Доступные склады (cursor-пагинация /v2/warehouse/list). */
    async listWarehouses(): Promise<FbsWarehouse[]> {
      const out: FbsWarehouse[] = []
      let cursor: string | undefined
      for (let page = 0; page < 50; page += 1) {
        const data = await call('/v2/warehouse/list', cursor ? { limit: 100, cursor } : { limit: 100 })
        for (const raw of array(data.warehouses)) {
          const w = object(raw); if (!w) continue
          const id = num(w.warehouse_id); if (id == null) continue
          out.push({ warehouseId: id, name: String(w.name ?? ''), type: str(w.warehouse_type), status: str(w.status) })
        }
        if (data.has_next !== true) break
        cursor = str(data.cursor) ?? undefined
        if (!cursor) break
      }
      return out
    },

    /** Существует ли склад с данным id и является ли он FBS. */
    async findWarehouse(warehouseId: number): Promise<FbsWarehouse | undefined> {
      return (await this.listWarehouses()).find((w) => w.warehouseId === warehouseId)
    },

    /** Дерево категорий → плоский список leaf-типов. */
    async listCategoryLeaves(): Promise<CategoryLeaf[]> {
      const data = await call('/v1/description-category/tree', { language: 'DEFAULT' })
      return extractCategoryLeaves(data.result)
    },

    /** Атрибуты выбранной пары категория/type. */
    async listCategoryAttributes(descriptionCategoryId: number, typeId: number): Promise<CategoryAttribute[]> {
      const data = await call('/v1/description-category/attribute', { description_category_id: descriptionCategoryId, type_id: typeId, language: 'DEFAULT' })
      return array(data.result).map(object).filter((x): x is Record<string, unknown> => Boolean(x)).map((a) => ({
        id: Number(a.id), complexId: Number(a.attribute_complex_id ?? 0), name: String(a.name ?? ''), type: str(a.type),
        isRequired: a.is_required === true, isCollection: a.is_collection === true, dictionaryId: Number(a.dictionary_id ?? 0),
        maxValueCount: a.max_value_count != null ? Number(a.max_value_count) : null,
      })).filter((a) => Number.isFinite(a.id))
    },

    /** Допустимые значения словарного атрибута (одна страница). */
    async listAttributeValues(descriptionCategoryId: number, typeId: number, attributeId: number, lastValueId = 0): Promise<{ values: AttributeValue[]; hasNext: boolean }> {
      const data = await call('/v1/description-category/attribute/values', { description_category_id: descriptionCategoryId, type_id: typeId, attribute_id: attributeId, language: 'DEFAULT', limit: 100, last_value_id: lastValueId })
      const values = array(data.result).map(object).filter((x): x is Record<string, unknown> => Boolean(x)).map((v) => ({ id: Number(v.id), value: String(v.value ?? '') })).filter((v) => Number.isFinite(v.id))
      return { values, hasNext: data.has_next === true }
    },

    /** Импорт/upsert карточек. Возвращает task_id асинхронного импорта. */
    async importProducts(items: Record<string, unknown>[]): Promise<{ taskId: string }> {
      const data = await call('/v3/product/import', { items })
      const result = object(data.result)
      const taskId = str(result?.task_id) ?? str(data.task_id)
      if (!taskId) throw new OzonApiError('Ozon не вернул task_id импорта', { status: 200, retryable: false, authFailed: false })
      return { taskId }
    },

    /** Статус асинхронного импорта по task_id. */
    async getImportInfo(taskId: string): Promise<ImportInfoItem[]> {
      const data = await call('/v1/product/import/info', { task_id: taskId })
      const result = object(data.result)
      return array(result?.items ?? data.items).map(object).filter((x): x is Record<string, unknown> => Boolean(x)).map((i) => ({
        offerId: String(i.offer_id ?? ''), productId: num(i.product_id), status: str(i.status),
        errors: array(i.errors).map((e) => { const o = object(e); return String(o?.message ?? o?.code ?? '') }).filter(Boolean),
      }))
    },

    /** Статус карточек (модерация/видимость/штрихкоды) — read-only. */
    async getProductInfo(params: { productIds?: number[]; offerIds?: string[] }): Promise<ProductInfoItem[]> {
      const data = await call('/v3/product/info/list', { product_id: params.productIds ?? [], offer_id: params.offerIds ?? [], sku: [] })
      return array(data.items).map(object).filter((x): x is Record<string, unknown> => Boolean(x)).map((i) => {
        const statuses = object(i.statuses)
        const barcodes = array(i.barcodes).map((b) => String(b)).filter(Boolean)
        const single = str(i.barcode); if (single) barcodes.push(single)
        return {
          offerId: str(i.offer_id), productId: num(i.product_id),
          moderateStatus: str(statuses?.moderate_status) ?? str(i.moderate_status),
          statusName: str(statuses?.status_name) ?? str(statuses?.status),
          visible: typeof i.visible === 'boolean' ? i.visible : null,
          barcodes: [...new Set(barcodes)],
        }
      })
    },

    /** Установить FBS-остаток на конкретном складе. */
    async setStock(params: { offerId: string; productId: number; stock: number; warehouseId: number }): Promise<void> {
      const data = await call('/v2/products/stocks', { stocks: [{ offer_id: params.offerId, product_id: params.productId, stock: params.stock, warehouse_id: params.warehouseId }] })
      const first = object(array(data.result)[0])
      if (first && first.updated === false) {
        const err = object(array(first.errors)[0])
        throw new OzonApiError(String(err?.message ?? err?.code ?? 'Ozon отклонил обновление остатка'), { status: 200, code: err?.code != null ? String(err.code) : null, retryable: false, authFailed: false })
      }
    },
  }
}

export type OzonFbsClient = ReturnType<typeof createOzonFbsClient>
