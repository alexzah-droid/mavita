'use client'
import { useState } from 'react'

type Props = {
  orderId: number
  cdekOrderUuid: string | null
  cdekNumber: string | null
  cdekWaybillUrl: string | null
  cdekBarcodeUrl: string | null
  cdekError: string | null
}

export default function AdminOrderCdek({ orderId, cdekOrderUuid, cdekNumber, cdekWaybillUrl: initialWaybillUrl, cdekBarcodeUrl: initialBarcodeUrl, cdekError }: Props) {
  const [waybillUrl, setWaybillUrl] = useState(initialWaybillUrl)
  const [barcodeUrl, setBarcodeUrl] = useState(initialBarcodeUrl)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')

  async function retry() {
    setBusy(true); setError(''); setInfo('')
    const res = await fetch(`/api/admin/orders/${orderId}/cdek-retry`, { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) setInfo('Задача поставлена — отправление будет создано в течение 30 секунд')
    else setError(data?.error?.messages?.[0] ?? 'Не удалось поставить задачу')
  }

  async function refresh() {
    setBusy(true); setError(''); setInfo('')
    const res = await fetch(`/api/admin/orders/${orderId}/waybill-refresh`, { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      if (data.waybillUrl) setWaybillUrl(data.waybillUrl)
      if (data.barcodeUrl) setBarcodeUrl(data.barcodeUrl)
      setInfo(data.waybillUrl || data.barcodeUrl ? 'Ссылки обновлены' : 'СДЭК ещё не сгенерировал файлы — попробуйте через минуту')
    } else {
      setError(data?.error?.messages?.[0] ?? 'Не удалось обновить')
    }
  }

  if (!cdekOrderUuid && !cdekError) return null

  return (
    <section style={{ marginTop: 24 }}>
      <h2>СДЭК</h2>
      {error && <p className="admin-error">{error}</p>}
      {info && <p>{info}</p>}
      {cdekOrderUuid && (
        <p>
          UUID: <code>{cdekOrderUuid}</code>
          {cdekNumber && <> · Накладная: <strong>{cdekNumber}</strong></>}
        </p>
      )}
      {(waybillUrl || barcodeUrl) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {waybillUrl && (
            <a href={waybillUrl} target="_blank" rel="noopener noreferrer" className="admin-button" style={{ display: 'inline-block' }}>
              Скачать накладную (PDF)
            </a>
          )}
          {barcodeUrl && (
            <a href={barcodeUrl} target="_blank" rel="noopener noreferrer" className="admin-button" style={{ display: 'inline-block' }}>
              Скачать стикер (штрихкод)
            </a>
          )}
          {cdekOrderUuid && (
            <button className="admin-button" type="button" disabled={busy} onClick={refresh} title="Обновить ссылки если истёк срок действия">
              {busy ? '…' : 'Обновить ссылки'}
            </button>
          )}
        </div>
      )}
      {cdekOrderUuid && !waybillUrl && !cdekError && (
        <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Накладная генерируется…</span>
          <button className="admin-button" type="button" disabled={busy} onClick={refresh}>{busy ? '…' : 'Обновить'}</button>
        </p>
      )}
      {cdekError && (
        <>
          <p className="admin-error">Ошибка СДЭК: {cdekError}</p>
          {!cdekOrderUuid && (
            <button className="admin-button" disabled={busy} onClick={retry}>
              {busy ? 'Ставим задачу…' : 'Повторить создание в СДЭК'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
