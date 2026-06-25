'use client'
import { useState } from 'react'
import type { CdekShipmentSettingsDto } from '@/lib/store-settings'

export default function CdekShipmentSettingsForm({ initial }: { initial: CdekShipmentSettingsDto }) {
  const [enabled, setEnabled] = useState(initial.autoShipmentEnabled)
  const [point, setPoint] = useState(initial.shipmentPoint ?? '')
  const [senderName, setSenderName] = useState(initial.senderName ?? '')
  const [senderPhone, setSenderPhone] = useState(initial.senderPhone ?? '')
  const [defWeight, setDefWeight] = useState(String(initial.defaultWeightGrams))
  const [defLen, setDefLen] = useState(String(initial.defaultLengthCm))
  const [defWid, setDefWid] = useState(String(initial.defaultWidthCm))
  const [defHgt, setDefHgt] = useState(String(initial.defaultHeightCm))
  const [mulLen, setMulLen] = useState(String(initial.multiLengthCm))
  const [mulWid, setMulWid] = useState(String(initial.multiWidthCm))
  const [mulHgt, setMulHgt] = useState(String(initial.multiHeightCm))
  const [webhookUuid, setWebhookUuid] = useState(initial.webhookUuid ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const canEnable = point.trim() && senderName.trim() && senderPhone.trim()

  async function save() {
    setBusy(true); setError(''); setInfo('')
    const res = await fetch('/api/admin/settings/cdek-shipment', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoShipmentEnabled: enabled,
        shipmentPoint: point.trim() || null,
        senderName: senderName.trim() || null,
        senderPhone: senderPhone.trim() || null,
        defaultWeightGrams: Number(defWeight),
        defaultLengthCm: Number(defLen),
        defaultWidthCm: Number(defWid),
        defaultHeightCm: Number(defHgt),
        multiLengthCm: Number(mulLen),
        multiWidthCm: Number(mulWid),
        multiHeightCm: Number(mulHgt),
        webhookUuid: webhookUuid.trim() || null,
      }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error?.messages?.[0] ?? 'Не удалось сохранить'); return }
    setInfo('Сохранено')
  }

  async function registerWebhook() {
    setBusy(true); setError(''); setInfo('')
    const res = await fetch('/api/admin/settings/cdek-shipment/webhook', { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error?.messages?.[0] ?? 'Не удалось зарегистрировать вебхук'); return }
    setWebhookUuid(data.uuid ?? '')
    setInfo('Вебхук зарегистрирован')
  }

  async function unregisterWebhook() {
    if (!webhookUuid) return
    if (!confirm('Удалить регистрацию вебхука СДЭК?')) return
    setBusy(true); setError(''); setInfo('')
    const res = await fetch('/api/admin/settings/cdek-shipment/webhook', { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { const d = await res.json().catch(() => null); setError(d?.error?.messages?.[0] ?? 'Ошибка'); return }
    setWebhookUuid('')
    setInfo('Вебхук удалён')
  }

  return (
    <div className="admin-settings" style={{ borderTop: '1px solid #3a3026', paddingTop: 16, marginTop: 16 }}>
      <h2 style={{ marginBottom: 8 }}>Автосоздание накладной в СДЭК</h2>
      <p style={{ marginBottom: 12, color: '#a0906c' }}>
        При включении каждый оплаченный СДЭК-заказ автоматически регистрируется через API и PDF-накладная
        появляется в карточке заказа. Для включения сначала заполните точку сдачи и данные отправителя.
      </p>
      {error && <p className="admin-error">{error}</p>}
      {info && <p>{info}</p>}
      <div className="admin-form-grid">
        <label>Точка сдачи СДЭК (код)<input value={point} onChange={(e) => setPoint(e.target.value)} placeholder="SPB116" /></label>
        <label>Отправитель (имя)<input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="МАВИТА" /></label>
        <label>Отправитель (телефон)<input value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} placeholder="+79211899008" /></label>
      </div>
      <fieldset style={{ marginTop: 12 }}>
        <legend>Упаковка по умолчанию (1 свеча)</legend>
        <div className="admin-form-grid">
          <label>Вес, г<input inputMode="numeric" value={defWeight} onChange={(e) => setDefWeight(e.target.value)} /></label>
          <label>Длина, см<input inputMode="numeric" value={defLen} onChange={(e) => setDefLen(e.target.value)} /></label>
          <label>Ширина, см<input inputMode="numeric" value={defWid} onChange={(e) => setDefWid(e.target.value)} /></label>
          <label>Высота, см<input inputMode="numeric" value={defHgt} onChange={(e) => setDefHgt(e.target.value)} /></label>
        </div>
      </fieldset>
      <fieldset style={{ marginTop: 8 }}>
        <legend>Коробка для нескольких свечей</legend>
        <div className="admin-form-grid">
          <label>Длина, см<input inputMode="numeric" value={mulLen} onChange={(e) => setMulLen(e.target.value)} /></label>
          <label>Ширина, см<input inputMode="numeric" value={mulWid} onChange={(e) => setMulWid(e.target.value)} /></label>
          <label>Высота, см<input inputMode="numeric" value={mulHgt} onChange={(e) => setMulHgt(e.target.value)} /></label>
        </div>
      </fieldset>
      <div style={{ marginTop: 12 }}>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEnable && !enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{' '}
          Автоматически создавать отправления в СДЭК
        </label>
        {!canEnable && !enabled && (
          <p className="admin-error" style={{ marginTop: 4 }}>
            Заполните точку сдачи, имя и телефон отправителя перед включением.
          </p>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="admin-button" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <span style={{ color: '#a0906c', fontSize: 13 }}>
          Вебхук: {webhookUuid ? `✅ ${webhookUuid.slice(0, 8)}…` : '⚠️ не зарегистрирован'}
        </span>
        {webhookUuid ? (
          <button className="admin-button" type="button" disabled={busy} onClick={unregisterWebhook} style={{ marginLeft: 'auto', color: '#b7704a' }}>
            Удалить вебхук
          </button>
        ) : (
          <button className="admin-button" type="button" disabled={busy || !point.trim()} onClick={registerWebhook}>
            Зарегистрировать вебхук
          </button>
        )}
      </div>
    </div>
  )
}
