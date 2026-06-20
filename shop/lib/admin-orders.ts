export type OrderStatus = 'pending' | 'paid' | 'cancelled'
export type FulfillmentStatus = 'awaiting_payment' | 'new' | 'packing' | 'handed_to_carrier' | 'delivered' | 'cancelled'
export type AdminOrderFilters = { status: OrderStatus | 'all'; dateFrom?: string; dateTo?: string; q?: string; limit: number; cursor?: { createdAt: string; id: number } }
export type Validation = { value?: never; errors: string[] }
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function maskPhone(phone: string | null): string | null { const digits = phone?.replace(/\D/g, ''); return digits && digits.length >= 4 ? `+${digits[0] ?? '7'} ••• •••-${digits.slice(-4, -2)}-${digits.slice(-2)}` : null }
function cursorDecode(raw: string): { createdAt: string; id: number } | undefined { try { const x = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); return typeof x?.createdAt === 'string' && !Number.isNaN(Date.parse(x.createdAt)) && Number.isInteger(x.id) && x.id > 0 ? x : undefined } catch { return undefined } }
export function cursorEncode(cursor: { createdAt: string; id: number }): string { return Buffer.from(JSON.stringify(cursor)).toString('base64url') }
export function parseAdminOrderFilters(search: URLSearchParams): { value?: AdminOrderFilters; errors: string[] } {
  const status = search.get('status') ?? 'all'; const limitRaw = search.get('limit') ?? '30'; const dateFrom = search.get('dateFrom') || undefined; const dateTo = search.get('dateTo') || undefined; const q = search.get('q')?.trim() || undefined; const errors: string[] = []
  if (!['all', 'pending', 'paid', 'cancelled'].includes(status)) errors.push('Некорректный статус')
  const limit = Number(limitRaw); if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.push('Лимит должен быть от 1 до 100')
  if ((dateFrom && !DATE.test(dateFrom)) || (dateTo && !DATE.test(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) errors.push('Некорректный период')
  if (q && (q.length > 100 || (/^\d+$/.test(q) ? q.length < 1 : q.length < 2))) errors.push('Некорректный поиск')
  const rawCursor = search.get('cursor'); const cursor = rawCursor ? cursorDecode(rawCursor) : undefined; if (rawCursor && !cursor) errors.push('Некорректный курсор')
  return errors.length ? { errors } : { value: { status: status as AdminOrderFilters['status'], dateFrom, dateTo, q, limit, cursor }, errors }
}
export function parseOrderId(raw: string): number | undefined { const id = Number(raw); return Number.isSafeInteger(id) && id > 0 ? id : undefined }
export function parseCancelBody(body: unknown): { value?: { reason: string }; errors: string[] } { const reason = body && typeof body === 'object' && Object.keys(body).length === 1 && typeof (body as { reason?: unknown }).reason === 'string' ? (body as { reason: string }).reason.trim() : ''; return reason.length >= 5 && reason.length <= 500 ? { value: { reason }, errors: [] } : { errors: ['Причина отмены должна содержать от 5 до 500 символов'] } }
export function parseFulfillmentBody(body: unknown): { value?: { status: 'packing' | 'handed_to_carrier' | 'delivered'; trackingNumber?: string }; errors: string[] } { if (!body || typeof body !== 'object') return { errors: ['Некорректное действие'] }; const x = body as Record<string, unknown>; const keys = Object.keys(x); if (x.status === 'packing' && keys.length === 1) return { value: { status: 'packing' }, errors: [] }; if (x.status === 'delivered' && keys.length === 1) return { value: { status: 'delivered' }, errors: [] }; const tracking = typeof x.trackingNumber === 'string' ? x.trackingNumber.trim() : ''; return x.status === 'handed_to_carrier' && keys.length === 2 && tracking.length >= 5 && tracking.length <= 64 ? { value: { status: 'handed_to_carrier', trackingNumber: tracking }, errors: [] } : { errors: ['Для передачи перевозчику нужен трек-номер от 5 до 64 символов'] } }
