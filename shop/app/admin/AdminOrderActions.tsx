'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdminOrderDetail } from '@/lib/admin-orders-db'

const CARRIER_NAME: Record<string, string> = { cdek: 'СДЭК' }

export default function AdminOrderActions({ order }: { order: AdminOrderDetail }) {
  const router = useRouter()
  const carrierName = order.deliveryCarrier ? CARRIER_NAME[order.deliveryCarrier] : 'перевозчика'
  const [reason, setReason] = useState('')
  const [tracking, setTracking] = useState('')
  const [error, setError] = useState('')
  const [cdekAnnulError, setCdekAnnulError] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(path: string, body: unknown) {
    setBusy(true)
    setError('')
    setCdekAnnulError('')
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => null)
    setBusy(false)
    if (!response.ok) {
      setError(data?.error?.messages?.[0] ?? 'Не удалось сохранить изменение')
      return
    }
    if (data?.cdekAnnulError) {
      setCdekAnnulError(`Заказ отменён, но СДЭК вернул ошибку при аннулировании: ${data.cdekAnnulError}`)
    }
    router.refresh()
  }

  const next = order.fulfillmentStatus === 'new' ? 'packing'
    : order.fulfillmentStatus === 'packing' ? 'handed_to_carrier'
    : order.fulfillmentStatus === 'handed_to_carrier' ? 'delivered'
    : null

  // Оплаченный заказ в стадии сборки можно отменить (до передачи перевозчику)
  const canCancelPaid = order.status === 'paid'
    && (order.fulfillmentStatus === 'new' || order.fulfillmentStatus === 'packing')

  return (
    <section className="admin-order-actions">
      {error && <p className="admin-error">{error}</p>}
      {cdekAnnulError && <p className="admin-error">{cdekAnnulError}</p>}

      {order.status === 'pending' && (
        <div>
          <h2>Отменить заказ</h2>
          <p>Отмена необратима. Если платёж уже проходит, деньги могут поступить после отмены — такой случай нужно сверить в Робокассе вручную.</p>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Причина отмены (5–500 символов)"
          />
          <button
            className="admin-button"
            disabled={busy || reason.trim().length < 5}
            onClick={() => send(`/api/admin/orders/${order.id}/cancel`, { reason })}
          >
            Отменить заказ
          </button>
        </div>
      )}

      {canCancelPaid && (
        <div>
          <h2>Отменить оплаченный заказ</h2>
          <p>
            Заказ оплачен — деньги уже получены. После отмены отправление в СДЭК будет аннулировано автоматически.
            Возврат средств оформляйте вручную через Робокассу.
          </p>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Причина отмены (5–500 символов)"
          />
          <button
            className="admin-button"
            disabled={busy || reason.trim().length < 5}
            onClick={() => send(`/api/admin/orders/${order.id}/cancel`, { reason })}
          >
            Отменить заказ и аннулировать отправление в СДЭК
          </button>
        </div>
      )}

      {next && (
        <div>
          <h2>Исполнение: {order.fulfillmentStatus}</h2>
          {next === 'handed_to_carrier' && (
            <input
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
              placeholder={`Трек-номер ${carrierName}`}
            />
          )}
          <button
            className="admin-button"
            disabled={busy || (next === 'handed_to_carrier' && tracking.trim().length < 5)}
            onClick={() => send(
              `/api/admin/orders/${order.id}/fulfillment`,
              next === 'handed_to_carrier' ? { status: next, trackingNumber: tracking } : { status: next },
            )}
          >
            {next === 'packing' ? 'Начать сборку' : next === 'handed_to_carrier' ? 'Передать перевозчику' : 'Отметить выдачу'}
          </button>
        </div>
      )}
    </section>
  )
}
