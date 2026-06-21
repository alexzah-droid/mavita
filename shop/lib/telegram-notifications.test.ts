import { describe, expect, it, vi } from 'vitest'
import { enqueueOrderNotification, formatTelegramOrderNotification, retryMinutes } from '@/lib/telegram-notifications'

describe('formatTelegramOrderNotification', () => {
  it('formats an anonymized payment notification with the protected admin link', () => {
    const previous = process.env.NEXT_PUBLIC_BASE_URL; process.env.NEXT_PUBLIC_BASE_URL = 'https://mavita.ru/'
    const text = formatTelegramOrderNotification({ orderId: 18, eventType: 'payment_paid', status: 'paid', fulfillmentStatus: 'new', totalKopecks: 360000, items: [{ productName: 'Свеча <b>Горы</b>', quantity: 2 }], createdAt: '2026-06-21T10:32:00.000Z', eventAt: '2026-06-21T10:32:00.000Z' })
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_URL; else process.env.NEXT_PUBLIC_BASE_URL = previous
    expect(text).toContain('заказ №18'); expect(text).toContain('Статус: оплачен'); expect(text).toContain('3 600 ₽'); expect(text).toContain('Свеча <b>Горы</b> × 2'); expect(text).toContain('https://mavita.ru/admin/orders/18')
  })

  it('adds only the relevant fulfillment metadata', () => {
    const text = formatTelegramOrderNotification({ orderId: 19, eventType: 'fulfillment_changed', status: 'paid', fulfillmentStatus: 'handed_to_carrier', totalKopecks: 100, items: [], createdAt: '2026-06-21T10:32:00.000Z', eventAt: '2026-06-21T10:32:00.000Z', trackingNumber: 'CDEK12345' })
    expect(text).toContain('Статус: передан перевозчику'); expect(text).toContain('Трек: CDEK12345')
  })

  it('does not repeat a tracking number in the delivered notification and stops retries after attempt 10', () => {
    const text = formatTelegramOrderNotification({ orderId: 20, eventType: 'fulfillment_changed', status: 'paid', fulfillmentStatus: 'delivered', totalKopecks: 100, items: [], createdAt: '2026-06-21T10:32:00.000Z', eventAt: '2026-06-21T11:32:00.000Z', trackingNumber: 'CDEK12345' })
    expect(text).not.toContain('Трек:'); expect(retryMinutes(9)).toBe(360); expect(retryMinutes(10)).toBeUndefined()
  })

  it('reads an order snapshot through the transaction client and inserts idempotently', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 3, status: 'paid', fulfillment_status: 'new', total_kopecks: 100, created_at: '2026-06-21T10:32:00.000Z', tracking_number: null }] }).mockResolvedValueOnce({ rows: [{ product_name: 'Свеча', quantity: 1 }] }).mockResolvedValueOnce({ rows: [] }) }
    await enqueueOrderNotification(client as never, { orderId: 3, eventType: 'payment_paid', eventKey: 'order:3:paid' })
    expect(client.query.mock.calls[2][0]).toContain('ON CONFLICT (event_key) DO NOTHING')
  })
})
