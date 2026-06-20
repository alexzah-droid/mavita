'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { AdminProduct } from '@/lib/admin-products-db'
import { isAccessibleByLink, moveInOrder, productPath, productUrl } from '@/lib/product-url'

const labels = { public: 'на витрине', unlisted: 'по ссылке', hidden: 'скрыт' }
type Filter = 'all' | 'public' | 'unlisted' | 'hidden'

export default function AdminProductsList({ initialProducts }: { initialProducts: AdminProduct[] }) {
  const [products, setProducts] = useState(initialProducts)
  const [filter, setFilter] = useState<Filter>('all')
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const [reorderError, setReorderError] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  useEffect(() => { setOrigin(window.location.origin) }, [])

  const shown = filter === 'all' ? products : products.filter((p) => p.visibility === filter)
  const sortable = filter === 'public'

  async function patch(id: number, change: object) {
    const response = await fetch(`/api/admin/products/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
    if (response.ok) { const product = await response.json(); setProducts((all) => all.map((p) => p.id === id ? product : p)) }
  }

  async function copyLink(product: AdminProduct) {
    try { await navigator.clipboard.writeText(productUrl(product.slug, origin)); setCopied(product.id); setTimeout(() => setCopied((c) => c === product.id ? null : c), 1500) } catch { /* копирование недоступно — остаётся видимый href */ }
  }

  // DnD по публичным товарам: переставляем локально, затем шлём полный список в reorder.
  async function reorder(fromId: number, toId: number) {
    setReorderError('')
    const publicProducts = products.filter((p) => p.visibility === 'public')
    const from = publicProducts.findIndex((p) => p.id === fromId)
    const to = publicProducts.findIndex((p) => p.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const reordered = moveInOrder(publicProducts, from, to)
    setProducts((all) => [...reordered, ...all.filter((p) => p.visibility !== 'public')])
    const response = await fetch('/api/admin/products/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productIds: reordered.map((p) => p.id) }) })
    if (!response.ok) {
      setReorderError(response.status === 409 ? 'Витрина изменилась в другом окне — список обновлён, повторите сортировку.' : 'Не удалось сохранить порядок.')
      const fresh = await fetch('/api/admin/products').then((r) => r.ok ? r.json() : null).catch(() => null)
      if (fresh?.products) setProducts(fresh.products)
    }
  }

  return <>
    <div className="admin-filters">{(['all', 'public', 'unlisted', 'hidden'] as const).map((item) =>
      <button className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item === 'all' ? 'Все' : labels[item]}</button>)}</div>
    {sortable && <p className="admin-hint">Перетаскивайте строки, чтобы изменить порядок товаров на витрине.</p>}
    {reorderError && <p className="admin-error">{reorderError}</p>}
    <div className="admin-table">{shown.map((product) =>
      <article
        className={`admin-row${sortable ? ' draggable' : ''}${dragId === product.id ? ' dragging' : ''}`}
        key={product.id}
        draggable={sortable}
        onDragStart={sortable ? () => setDragId(product.id) : undefined}
        onDragOver={sortable ? (e) => e.preventDefault() : undefined}
        onDrop={sortable ? (e) => { e.preventDefault(); if (dragId !== null) reorder(dragId, product.id); setDragId(null) } : undefined}
        onDragEnd={sortable ? () => setDragId(null) : undefined}
      >
        <div>{sortable && <span className="admin-drag-handle" aria-hidden>⠿</span>}{product.images[0]
          ? <img src={product.images.find((image) => image.isCover)?.filename ?? product.images[0].filename} alt="" />
          : <div className="admin-placeholder" />}</div>
        <div>
          <strong>{product.name}</strong>
          <small>{product.slug}</small>
          {isAccessibleByLink(product.visibility)
            ? <small className="admin-link-row">
                <a href={productPath(product.slug)} target="_blank" rel="noreferrer">{origin ? productUrl(product.slug, origin) : productPath(product.slug)}</a>
                <button type="button" className="admin-copy" onClick={() => copyLink(product)}>{copied === product.id ? 'скопировано' : 'копировать'}</button>
              </small>
            : <small className="admin-link-row muted">нет прямой ссылки (товар скрыт)</small>}
        </div>
        <div><span className={`admin-badge ${product.visibility}`}>{labels[product.visibility]}</span><small>{product.inStock ? 'в наличии' : 'нет в наличии'}{product.isSaleActive ? ' · скидка активна' : ''}</small></div>
        <div className="admin-row-actions">
          <select value={product.visibility} onChange={(e) => patch(product.id, { visibility: e.target.value })}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <label><input type="checkbox" checked={product.inStock} onChange={(e) => patch(product.id, { inStock: e.target.checked })} /> наличие</label>
          <Link href={`/admin/products/${product.id}/edit`}>Изменить</Link>
        </div>
      </article>)}</div>
  </>
}
