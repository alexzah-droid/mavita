'use client'
// Блок «Ozon Доставка» в карточке товара: технический FBS-профиль + действия
// оператора. inStock сайта — отдельный чекбокс и здесь НЕ трогается. Ненулевой
// остаток возможен только после модерации, ручного скрытия в ЛК и подтверждения.
import { useEffect, useState } from 'react'

type Attribute = { attributeId: number; complexId: number; values: { dictionaryValueId?: number; value?: string }[] }
type Profile = {
  productId: number; enabled: boolean; offerId: string; fbsStockQuantity: number
  descriptionCategoryId: number | null; typeId: number | null; barcode: string | null
  weightGrams: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null
  attributes: Attribute[]; ozonProductId: number | null; remoteState: string; moderationStatus: string | null
  complianceStatus: 'not_checked' | 'ready' | 'blocked'; complianceNote: string | null
  contentSyncedAt: string | null; stockSyncedAt: string | null; lastStockSentQuantity: number
  hiddenVerificationMethod: 'api' | 'operator' | null; manualHiddenConfirmedAt: string | null
  lastErrorCode: string | null; lastErrorMessage: string | null
}

const STATE_LABEL: Record<string, string> = {
  not_synced: 'не синхронизирован', pending: 'отправляется…', awaiting_moderation: 'ожидает модерации',
  awaiting_manual_hide: 'ждёт ручного скрытия в ЛК', hidden_confirmed: 'скрыт (подтверждено)',
  invalid: 'не готов', failed: 'ошибка', disabled: 'отключён',
}
const num = (v: string) => (v.trim() === '' ? null : Number(v))

export default function OzonProfilePanel({ productId }: { productId: number }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // редактируемые поля
  const [enabled, setEnabled] = useState(false)
  const [stock, setStock] = useState('0')
  const [categoryId, setCategoryId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [barcode, setBarcode] = useState('')
  const [weight, setWeight] = useState('')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [attributesJson, setAttributesJson] = useState('[]')
  const [compliance, setCompliance] = useState<'not_checked' | 'ready' | 'blocked'>('not_checked')
  const [complianceNote, setComplianceNote] = useState('')

  function hydrate(p: Profile) {
    setProfile(p); setEnabled(p.enabled); setStock(String(p.fbsStockQuantity))
    setCategoryId(p.descriptionCategoryId?.toString() ?? ''); setTypeId(p.typeId?.toString() ?? '')
    setBarcode(p.barcode ?? ''); setWeight(p.weightGrams?.toString() ?? '')
    setLength(p.lengthMm?.toString() ?? ''); setWidth(p.widthMm?.toString() ?? ''); setHeight(p.heightMm?.toString() ?? '')
    setAttributesJson(JSON.stringify(p.attributes, null, 2)); setCompliance(p.complianceStatus); setComplianceNote(p.complianceNote ?? '')
  }

  useEffect(() => { fetch(`/api/admin/products/${productId}/ozon-profile`).then((r) => (r.ok ? r.json() : null)).then((p) => p && hydrate(p)).catch(() => setMessage('Не удалось загрузить профиль Ozon')) }, [productId])

  async function save() {
    setBusy(true); setMessage('')
    let attributes: unknown
    try { attributes = JSON.parse(attributesJson) } catch { setBusy(false); setMessage('Атрибуты — некорректный JSON'); return }
    const body: Record<string, unknown> = {
      enabled, fbsStockQuantity: Number(stock) || 0,
      descriptionCategoryId: num(categoryId), typeId: num(typeId), barcode: barcode.trim() || null,
      weightGrams: num(weight), lengthMm: num(length), widthMm: num(width), heightMm: num(height),
      attributes, complianceStatus: compliance, complianceNote: complianceNote.trim() || null,
    }
    const res = await fetch(`/api/admin/products/${productId}/ozon-profile`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) { hydrate(data); setMessage('Профиль сохранён') }
    else setMessage(data?.error?.messages?.join('; ') ?? 'Не удалось сохранить профиль')
  }

  async function action(path: string, label: string, payload?: unknown) {
    setBusy(true); setMessage('')
    const res = await fetch(`/api/admin/products/${productId}/ozon-profile/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setMessage(data?.error?.messages?.join('; ') ?? `${label}: ошибка`); return }
    if (path === 'dry-run') { setMessage(data.ready ? 'Готов к загрузке ✓' : `Не готов: ${data.errors.join('; ')}`); return }
    setMessage(`${label}: готово`)
    const fresh = await fetch(`/api/admin/products/${productId}/ozon-profile`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (fresh) hydrate(fresh)
  }

  if (!profile) return <fieldset className="admin-card"><legend>Ozon Доставка</legend><p>{message || 'Загрузка…'}</p></fieldset>

  return (
    <fieldset className="admin-card">
      <legend>Ozon Доставка (FBS)</legend>
      <p className="admin-hint">offer_id: <code>{profile.offerId}</code> · статус: <strong>{STATE_LABEL[profile.remoteState] ?? profile.remoteState}</strong>{profile.moderationStatus ? ` · модерация: ${profile.moderationStatus}` : ''}</p>

      <label className="admin-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Синхронизировать с Ozon</label>

      <label>FBS-лимит для Ozon (НЕ наличие на сайте)
        <input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} />
      </label>

      <div className="admin-grid-2">
        <label>description_category_id<input value={categoryId} onChange={(e) => setCategoryId(e.target.value)} inputMode="numeric" /></label>
        <label>type_id<input value={typeId} onChange={(e) => setTypeId(e.target.value)} inputMode="numeric" /></label>
        <label>Штрихкод<input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Ozon создаст при первом import" /></label>
        <label>Вес, г<input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" /></label>
        <label>Длина, мм<input value={length} onChange={(e) => setLength(e.target.value)} inputMode="numeric" /></label>
        <label>Ширина, мм<input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="numeric" /></label>
        <label>Высота, мм<input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="numeric" /></label>
      </div>

      <label>Атрибуты категории (JSON: [{'{'} attributeId, complexId, values: [{'{'} dictionaryValueId {'}'} | {'{'} value {'}'} ] {'}'}])
        <textarea rows={6} value={attributesJson} onChange={(e) => setAttributesJson(e.target.value)} spellCheck={false} />
      </label>

      <div className="admin-grid-2">
        <label>Готовность к модерации
          <select value={compliance} onChange={(e) => setCompliance(e.target.value as typeof compliance)}>
            <option value="not_checked">не проверено</option>
            <option value="ready">готово (сертификат/декларация в ЛК)</option>
            <option value="blocked">заблокировано</option>
          </select>
        </label>
        <label>Заметка о сертификате/декларации<input value={complianceNote} onChange={(e) => setComplianceNote(e.target.value)} /></label>
      </div>

      <p className="admin-warning">⚠️ После import карточка станет публичной на витрине Ozon с остатком 0. После модерации скройте её вручную в ЛК (бейдж «Ozon Доставка»), подтвердите скрытие здесь и только затем выставляйте остаток.</p>

      {profile.hiddenVerificationMethod === 'operator' && <p className="admin-hint">Скрытие подтверждено оператором (honor-system, не автоматическая проверка Ozon).</p>}
      {profile.lastErrorMessage && <p className="admin-error">Последняя ошибка: {profile.lastErrorMessage}</p>}

      <div className="admin-actions">
        <button type="button" onClick={save} disabled={busy}>Сохранить профиль</button>
        <button type="button" onClick={() => action('dry-run', 'Проверка готовности')} disabled={busy}>Проверить готовность</button>
        <button type="button" onClick={() => action('import', 'Импорт с остатком 0')} disabled={busy}>Импортировать с остатком 0</button>
        <button type="button" onClick={() => action('check-moderation', 'Проверка модерации')} disabled={busy || profile.remoteState !== 'awaiting_moderation'}>Проверить модерацию</button>
        <button type="button" onClick={() => action('confirm-hidden', 'Подтверждение скрытия')} disabled={busy || profile.remoteState !== 'awaiting_manual_hide'}>Подтвердить скрытие в ЛК</button>
        <button type="button" onClick={() => action('stock-sync', 'Обновление остатка')} disabled={busy}>Обновить остаток</button>
        <button type="button" onClick={() => action('stock-sync', 'Обнуление остатка', { zero: true })} disabled={busy}>Обнулить остаток в Ozon</button>
      </div>

      {message && <p className="admin-message">{message}</p>}
    </fieldset>
  )
}
