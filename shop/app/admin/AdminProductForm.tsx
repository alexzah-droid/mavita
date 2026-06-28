'use client'
import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { AdminImage, AdminProduct } from '@/lib/admin-products-db'
import { dateTimeLocalToInstant, instantToDateTimeLocal } from '@/lib/admin-product-datetime'
import { effectivePrice } from '@/lib/pricing'
import { moveInOrder } from '@/lib/product-url'
import { slugify } from '@/lib/slug'

const rubles = (value: number) => String(value / 100).replace('.', ',')
const kopecks = (value: string) => Math.round(Number(value.replace(',', '.')) * 100)

// Состояние одного datetime-local поля. Храним исходный ISO-момент и признак
// изменения: пока поле не менялось, в PATCH уходит исходный instant, а не результат
// обратного преобразования отображённой строки — это сохраняет момент даже в
// DST-overlap. `error` ставится либо при загрузке не-минутного instant, либо при
// вводе несуществующего DST-gap времени; пока он есть, сохранять нельзя.
type DateState = { value: string; original: string | null; dirty: boolean; error: string; warning: string }
type Resolved = { ok: true; value: string | null } | { ok: false; message: string }
function initDate(iso: string | null): DateState {
  if (!iso) return { value: '', original: null, dirty: false, error: '', warning: '' }
  const result = instantToDateTimeLocal(iso)
  return result.ok ? { value: result.value, original: iso, dirty: false, error: '', warning: '' } : { value: '', original: iso, dirty: false, error: result.message, warning: '' }
}
function changeDate(value: string): DateState {
  if (value === '') return { value, original: null, dirty: true, error: '', warning: '' }
  const result = dateTimeLocalToInstant(value)
  return { value, original: null, dirty: true, error: result.ok ? '' : result.message, warning: result.ok ? (result.warning ?? '') : '' }
}
function resolveInstant(state: DateState): Resolved {
  if (state.error) return { ok: false, message: state.error }
  if (state.value === '') return { ok: true, value: null }
  if (!state.dirty && state.original) return { ok: true, value: state.original }
  return dateTimeLocalToInstant(state.value)
}

export default function AdminProductForm({ product }: { product?: AdminProduct }) {
  const router = useRouter()
  const [name, setName] = useState(product?.name ?? '')
  const [slug, setSlug] = useState(product?.slug ?? '')
  const [price, setPrice] = useState(product ? rubles(product.priceKopecks) : '')
  const [series, setSeries] = useState(product?.series ?? '')
  const [subtitle, setSubtitle] = useState(product?.subtitle ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [scent, setScent] = useState(product?.scent.join(', ') ?? '')
  const [visibility, setVisibility] = useState(product?.visibility ?? 'hidden')
  const [inStock, setInStock] = useState(product?.inStock ?? true)
  const [salePrice, setSalePrice] = useState(product?.sale ? rubles(product.sale.priceKopecks) : '')
  const [startsAt, setStartsAt] = useState<DateState>(initDate(product?.sale?.startsAt ?? null))
  const [endsAt, setEndsAt] = useState<DateState>(initDate(product?.sale?.endsAt ?? null))
  const [weightGrams, setWeightGrams] = useState(product?.weightGrams != null ? String(product.weightGrams) : '')
  const [boxLengthCm, setBoxLengthCm] = useState(product?.boxLengthCm != null ? String(product.boxLengthCm) : '')
  const [boxWidthCm, setBoxWidthCm] = useState(product?.boxWidthCm != null ? String(product.boxWidthCm) : '')
  const [boxHeightCm, setBoxHeightCm] = useState(product?.boxHeightCm != null ? String(product.boxHeightCm) : '')
  const [message, setMessage] = useState('')
  const [images, setImages] = useState<AdminImage[]>(product?.images ?? [])
  const [confirmName, setConfirmName] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const coverId = images.find((image) => image.isCover)?.id ?? images[0]?.id

  const preview = useMemo(() => {
    const starts = resolveInstant(startsAt); const ends = resolveInstant(endsAt)
    if (!starts.ok || !ends.ok) return { error: (!starts.ok ? starts.message : (ends as { message: string }).message), price: effectivePrice({ priceKopecks: kopecks(price), salePriceKopecks: null, saleStartsAt: null, saleEndsAt: null }, new Date()) }
    return { error: '', price: effectivePrice({ priceKopecks: kopecks(price), salePriceKopecks: salePrice ? kopecks(salePrice) : null, saleStartsAt: starts.value, saleEndsAt: ends.value }, new Date()) }
  }, [price, salePrice, startsAt, endsAt])

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage('')
    let sale = null
    if (salePrice) {
      const starts = resolveInstant(startsAt); const ends = resolveInstant(endsAt)
      if (!starts.ok) return setMessage(starts.message)
      if (!ends.ok) return setMessage(ends.message)
      sale = { priceKopecks: kopecks(salePrice), startsAt: starts.value, endsAt: ends.value }
    }
    const weightGramsNum = weightGrams.trim() ? Number(weightGrams.trim()) : null
    if (weightGramsNum !== null && (!Number.isInteger(weightGramsNum) || weightGramsNum <= 0)) return setMessage('Вес должен быть положительным целым числом')
    const boxLengthCmNum = boxLengthCm.trim() ? Number(boxLengthCm.trim()) : null
    const boxWidthCmNum = boxWidthCm.trim() ? Number(boxWidthCm.trim()) : null
    const boxHeightCmNum = boxHeightCm.trim() ? Number(boxHeightCm.trim()) : null
    if (boxLengthCmNum !== null && (!Number.isInteger(boxLengthCmNum) || boxLengthCmNum <= 0)) return setMessage('Длина коробки должна быть положительным целым числом')
    if (boxWidthCmNum !== null && (!Number.isInteger(boxWidthCmNum) || boxWidthCmNum <= 0)) return setMessage('Ширина коробки должна быть положительным целым числом')
    if (boxHeightCmNum !== null && (!Number.isInteger(boxHeightCmNum) || boxHeightCmNum <= 0)) return setMessage('Высота коробки должна быть положительным целым числом')
    const body = {
      name,
      slug,
      priceKopecks: kopecks(price),
      series: series || null,
      subtitle: subtitle || null,
      description: description || null,
      scent: scent.split(',').map((x) => x.trim()).filter(Boolean),
      visibility,
      inStock,
      sale,
      weightGrams: weightGramsNum,
      boxLengthCm: boxLengthCmNum,
      boxWidthCm: boxWidthCmNum,
      boxHeightCm: boxHeightCmNum,
    }
    const response = await fetch(product ? `/api/admin/products/${product.id}` : '/api/admin/products', { method: product ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (response.ok) { const saved = await response.json(); router.replace(`/admin/products/${saved.id}/edit`); router.refresh() }
    else { const error = await response.json().catch(() => null); setMessage(error?.error?.messages?.join('. ') ?? 'Не удалось сохранить') }
  }

  async function upload(files: FileList | null) {
    if (!product || !files?.length) return
    const data = new FormData(); data.set('productId', String(product.id)); [...files].forEach((file) => data.append('files', file))
    const response = await fetch('/api/upload', { method: 'POST', body: data })
    if (response.ok) { const result = await response.json(); setImages((old) => [...old, ...result.images]) }
    else setMessage((await response.json()).error?.messages?.[0] ?? 'Не удалось загрузить фото')
  }

  // Любое действие с фото шлёт полный актуальный порядок и обложку; форма заменяет
  // локальный список ответом сервера (исключает следующее действие на устаревшей
  // cover). На 409 — GET товара и сообщение; на иную ошибку — откат к серверу.
  async function saveImages(ordered: AdminImage[], cover: number) {
    if (!product) return
    const response = await fetch(`/api/admin/products/${product.id}/images`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedImageIds: ordered.map((image) => image.id), coverImageId: cover }) })
    if (response.ok) { setImages((await response.json()).images); setMessage('') }
    else { const fresh = await fetch(`/api/admin/products/${product.id}`).then((r) => r.ok ? r.json() : null).catch(() => null); if (fresh?.images) setImages(fresh.images); setMessage(response.status === 409 ? 'Список фото изменился в другом окне — повторите действие' : 'Не удалось сохранить порядок фото') }
  }

  async function removeImage(id: number) {
    if (!product) return
    const response = await fetch(`/api/admin/products/${product.id}/images/${id}`, { method: 'DELETE' })
    if (response.ok) { setImages((await response.json()).images); router.refresh() }
    else setMessage('Не удалось удалить фото')
  }

  function moveImage(index: number, direction: -1 | 1) {
    if (coverId === undefined) return
    saveImages(moveInOrder(images, index, index + direction), coverId)
  }

  async function archive() {
    if (!product) return
    const response = await fetch(`/api/admin/products/${product.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: 'hidden' }) })
    if (response.ok) { setVisibility('hidden'); setMessage('Товар архивирован (скрыт)'); router.refresh() }
    else setMessage('Не удалось архивировать товар')
  }

  async function hardDelete() {
    if (!product) return
    const response = await fetch(`/api/admin/products/${product.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmationName: confirmName }) })
    if (response.ok) { router.replace('/admin'); router.refresh() }
    else { const error = await response.json().catch(() => null); setMessage(error?.error?.messages?.join('. ') ?? 'Не удалось удалить товар') }
  }

  return <form className="admin-form" onSubmit={submit}>
    <div className="admin-form-grid">
      <label>Название<input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Slug<div className="admin-inline"><input required value={slug} onChange={(e) => setSlug(e.target.value)} /><button type="button" onClick={() => setSlug(slugify(name))}>из названия</button></div></label>
      <label>Цена, ₽<input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label>Серия<input value={series} onChange={(e) => setSeries(e.target.value)} /></label>
      <label>Подзаголовок<input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} /></label>
      <label>Ароматы через запятую<input value={scent} onChange={(e) => setScent(e.target.value)} /></label>
      <label>Вес, г (для СДЭК)<input inputMode="numeric" value={weightGrams} placeholder="500" onChange={(e) => setWeightGrams(e.target.value)} /></label>
      <label>Коробка: длина, см<input inputMode="numeric" value={boxLengthCm} placeholder="11" onChange={(e) => setBoxLengthCm(e.target.value)} /></label>
      <label>Коробка: ширина, см<input inputMode="numeric" value={boxWidthCm} placeholder="11" onChange={(e) => setBoxWidthCm(e.target.value)} /></label>
      <label>Коробка: высота, см<input inputMode="numeric" value={boxHeightCm} placeholder="11" onChange={(e) => setBoxHeightCm(e.target.value)} /></label>
      <label className="admin-wide">Описание<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    </div>
    <fieldset><legend>Витрина</legend>
      {([['public', 'На витрине'], ['unlisted', 'Только по ссылке'], ['hidden', 'Скрыт']] as const).map(([value, text]) =>
        <label className="admin-radio" key={value}><input type="radio" checked={visibility === value} value={value} onChange={() => setVisibility(value)} />{text}</label>)}
      <label className="admin-radio"><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> В наличии</label>
    </fieldset>
    <fieldset><legend>Скидка</legend>
      <div className="admin-form-grid">
        <label>Цена скидки, ₽<input inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></label>
        <label>Начало <small>(часовой пояс браузера)</small><input type="datetime-local" step={60} value={startsAt.value} onChange={(e) => setStartsAt(changeDate(e.target.value))} />{startsAt.error && <small className="admin-error">{startsAt.error}</small>}{startsAt.warning && <small className="admin-warning">{startsAt.warning}</small>}</label>
        <label>Окончание <small>(часовой пояс браузера)</small><input type="datetime-local" step={60} value={endsAt.value} onChange={(e) => setEndsAt(changeDate(e.target.value))} />{endsAt.error && <small className="admin-error">{endsAt.error}</small>}{endsAt.warning && <small className="admin-warning">{endsAt.warning}</small>}</label>
      </div>
      {preview.error ? <p className="admin-error">{preview.error}</p> : <p>Сейчас: {preview.price.kopecks / 100} ₽ {preview.price.isOnSale ? '(скидка активна)' : '(обычная цена)'}</p>}
      <button type="button" onClick={() => { setSalePrice(''); setStartsAt(initDate(null)); setEndsAt(initDate(null)) }}>Убрать скидку</button>
    </fieldset>
    {product && <fieldset><legend>Фото</legend>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => upload(e.target.files)} />
      <div className="admin-images">{images.map((image, index) =>
        <div key={image.id}>
          <img src={image.filename} alt="" />
          <div className="admin-image-order">
            <button type="button" aria-label="Левее" disabled={index === 0} onClick={() => moveImage(index, -1)}>◀</button>
            <button type="button" aria-label="Правее" disabled={index === images.length - 1} onClick={() => moveImage(index, 1)}>▶</button>
          </div>
          <button type="button" onClick={() => coverId !== undefined && saveImages(images, image.id)}>{image.isCover ? 'Обложка' : 'Сделать обложкой'}</button>
          <button type="button" onClick={() => removeImage(image.id)}>Удалить</button>
        </div>)}</div>
    </fieldset>}
    {message && <p className="admin-error">{message}</p>}
    <button className="admin-button">Сохранить</button>
    {product && <fieldset className="admin-danger"><legend>Опасная зона</legend>
      <p>Архивирование скрывает товар с витрины и по прямой ссылке, но сохраняет данные и историю заказов.</p>
      <button type="button" onClick={archive}>Архивировать</button>
      <hr />
      <p>Удаление навсегда необратимо и доступно только после подтверждения точным названием товара.</p>
      <button type="button" className="admin-danger-button" onClick={() => { setConfirmName(''); setConfirmOpen(true) }}>Удалить навсегда</button>
    </fieldset>}
    {product && confirmOpen && <div className="admin-modal-overlay" role="presentation" onClick={() => setConfirmOpen(false)}>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Подтверждение удаления товара" onClick={(e) => e.stopPropagation()}>
        <h2>Удалить товар навсегда?</h2>
        <p>Действие необратимо. Введите точное название товара <strong>{product.name}</strong> для подтверждения.</p>
        <input autoFocus value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder="Название товара" />
        <div className="admin-modal-actions">
          <button type="button" onClick={() => setConfirmOpen(false)}>Отмена</button>
          <button type="button" className="admin-danger-button" disabled={confirmName !== product.name} onClick={hardDelete}>Удалить безвозвратно</button>
        </div>
      </div>
    </div>}
  </form>
}
