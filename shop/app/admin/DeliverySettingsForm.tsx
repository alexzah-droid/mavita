'use client'
import { useState } from 'react'
import type { Carrier, CarrierSettings, DeliverySettings } from '@/lib/store-settings'

const CARRIERS: { carrier: Carrier; label: string; idLabel: string; secretLabel: string }[] = [
  { carrier: 'cdek', label: 'СДЭК', idLabel: 'Client ID', secretLabel: 'Client Secret' },
]

function statusLine(c: CarrierSettings): string {
  if (!c.hasSecret) return '⚠️ нет ключей'
  const tariff = c.deliveryKopecks === null ? 'нет тарифа' : c.deliveryKopecks === 0 ? 'бесплатно' : `тариф ${(c.deliveryKopecks / 100).toLocaleString('ru-RU')} ₽`
  return `${c.enabled ? '✅ включён' : 'выключен'} · ключи заданы · ${tariff}`
}

function CarrierCard({ carrier, label, idLabel, secretLabel, initial, onSaved }: {
  carrier: Carrier; label: string; idLabel: string; secretLabel: string; initial: CarrierSettings; onSaved: (s: DeliverySettings) => void
}) {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [clientId, setClientId] = useState(initial.clientId ?? '')
  const [secret, setSecret] = useState('') // пустое = не менять
  const [secretTouched, setSecretTouched] = useState(false)
  const [free, setFree] = useState(initial.deliveryKopecks === 0)
  const [rubles, setRubles] = useState(initial.deliveryKopecks != null ? String(initial.deliveryKopecks / 100) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [hasSecret, setHasSecret] = useState(initial.hasSecret)
  const [secretMask, setSecretMask] = useState(initial.secretMask)

  async function send(path: string, payload: object): Promise<DeliverySettings | null> {
    setBusy(true); setError(''); setInfo('')
    const res = await fetch(path, { method: path.endsWith('/delivery') ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error?.messages?.[0] ?? (res.status === 429 ? 'Слишком много попыток' : 'Не удалось выполнить')); return null }
    return data
  }

  async function save() {
    const deliveryKopecks = free ? 0 : Math.round(Number(rubles.replace(',', '.')) * 100)
    if (!free && (!Number.isSafeInteger(deliveryKopecks) || deliveryKopecks < 0)) { setError('Введите неотрицательную цену в рублях'); return }
    const patch: Record<string, unknown> = { carrier, enabled, deliveryKopecks }
    if (clientId.trim()) patch.clientId = clientId.trim()
    if (secretTouched && secret.trim()) patch.secret = secret.trim()
    const data = await send('/api/admin/settings/delivery', patch)
    if (data) { onSaved(data); const c = data.carriers[carrier]; setHasSecret(c.hasSecret); setSecretMask(c.secretMask); setSecret(''); setSecretTouched(false); setInfo('Сохранено. Новый тариф применяется только к будущим заказам.') }
  }

  async function test() {
    const payload: Record<string, unknown> = { carrier }
    if (clientId.trim()) payload.clientId = clientId.trim()
    if (secretTouched && secret.trim()) payload.secret = secret.trim()
    const res = await fetch('/api/admin/settings/delivery/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json().catch(() => null)
    if (res.status === 429) { setError('Слишком много попыток проверки. Подождите.'); return }
    if (data?.ok) setInfo(`Связь есть: найдено пунктов — ${data.sampleCount}`)
    else setError(data?.code === 'auth_failed' ? 'Неверные ключи' : data?.code === 'credentials_missing' ? 'Заполните ключи перед проверкой' : 'Перевозчик недоступен')
  }

  async function clearKeys() {
    if (!confirm(`Удалить ключи ${label}? Перевозчик будет выключен.`)) return
    const data = await send('/api/admin/settings/delivery/clear', { carrier })
    if (data) { onSaved(data); const c = data.carriers[carrier]; setEnabled(c.enabled); setClientId(''); setSecret(''); setSecretTouched(false); setHasSecret(false); setSecretMask(null); setInfo('Ключи удалены, перевозчик выключен.') }
  }

  return (
    <div className="admin-settings" style={{ borderTop: '1px solid #3a3026', paddingTop: 16, marginTop: 16 }}>
      <h2 style={{ marginBottom: 8 }}>{label}</h2>
      <p>{statusLine({ enabled, hasSecret, secretMask, clientId: clientId || null, deliveryKopecks: free ? 0 : Math.round(Number(rubles.replace(',', '.')) * 100) || null })}</p>
      {error && <p className="admin-error">{error}</p>}
      {info && <p>{info}</p>}
      <label className="checkout-field"><span>{idLabel}</span><input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" /></label>
      <label className="checkout-field"><span>{secretLabel}</span>
        <input type="password" value={secret} placeholder={secretMask ?? 'не задан'} autoComplete="off"
          onChange={(e) => { setSecret(e.target.value); setSecretTouched(true) }} />
      </label>
      <label className="checkout-field"><span>Тариф, ₽</span><input inputMode="decimal" value={rubles} disabled={free} onChange={(e) => setRubles(e.target.value)} /></label>
      <label><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> Бесплатно</label>
      <br />
      <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Включён</label>
      {!hasSecret && enabled && <p className="admin-error">Чтобы включить — задайте ключи и тариф.</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="admin-button" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <button className="admin-button" type="button" disabled={busy} onClick={test}>Проверить связь</button>
        {hasSecret && <button className="admin-button" type="button" disabled={busy} onClick={clearKeys} style={{ marginLeft: 'auto', color: '#b7704a' }}>Удалить ключи</button>}
      </div>
    </div>
  )
}

export default function DeliverySettingsForm({ initial }: { initial: DeliverySettings }) {
  const [settings, setSettings] = useState(initial)
  return (
    <div>
      <p>Перевозчики и тарифы. Секреты хранятся в БД шифрованными и в браузер не возвращаются — поле показывает только маску.</p>
      {CARRIERS.map((c) => (
        <CarrierCard key={c.carrier} {...c} initial={settings.carriers[c.carrier]} onSaved={setSettings} />
      ))}
      {settings.updatedAt && <p style={{ marginTop: 16 }}>Последнее изменение: {new Date(settings.updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>}
    </div>
  )
}
