'use client'

import { useState } from 'react'
import type { SiteContent, StihiiContent } from '@/lib/site-content'

const ABOUT_TEXT_MAX_LENGTH = 5000

export default function AboutContentForm({ initial }: { initial: SiteContent }) {
  const [aboutText, setAboutText] = useState(initial.aboutText)
  const [stihii, setStihii] = useState(initial.stihii)
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true); setError(''); setSaved(false)
    const response = await fetch('/api/admin/settings/content', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aboutText, stihii }),
    })
    const body = await response.json().catch(() => null)
    setBusy(false)
    if (!response.ok) { setError(body?.error?.messages?.[0] ?? 'Не удалось сохранить текст'); return }
    setAboutText(body.aboutText); setStihii(body.stihii); setUpdatedAt(body.updatedAt); setSaved(true)
  }

  function updateTile(tile: keyof StihiiContent, field: keyof StihiiContent['gory'], value: string) {
    setStihii((current) => ({ ...current, [tile]: { ...current[tile], [field]: value } }))
  }

  return (
    <div className="admin-settings">
      <p>Абзацы разделяются пустой строкой. Изменение сразу появится на главной странице.</p>
      {error && <p className="admin-error">{error}</p>}
      {saved && <p className="admin-success">Текст сохранён.</p>}
      <label className="checkout-field">
        <span>Текст раздела «О бренде»</span>
        <textarea className="admin-content-textarea" value={aboutText} maxLength={ABOUT_TEXT_MAX_LENGTH} onChange={(event) => setAboutText(event.target.value)} />
      </label>
      <p>{aboutText.length} / {ABOUT_TEXT_MAX_LENGTH} символов</p>
      <h2>Три стихии</h2>
      <p>Слоган, описание и строка нот отображаются внутри соответствующей плитки.</p>
      {([
        ['gory', 'Горы'],
        ['more', 'Море'],
        ['les', 'Лес'],
      ] as const).map(([key, title]) => (
        <fieldset className="admin-content-tile" key={key}>
          <legend>{title}</legend>
          <label className="checkout-field">
            <span>Слоган</span>
            <input value={stihii[key].state} maxLength={1000} onChange={(event) => updateTile(key, 'state', event.target.value)} />
          </label>
          <label className="checkout-field">
            <span>Описание</span>
            <textarea value={stihii[key].desc} maxLength={1000} onChange={(event) => updateTile(key, 'desc', event.target.value)} />
          </label>
          <label className="checkout-field">
            <span>Ноты аромата</span>
            <input value={stihii[key].scents} maxLength={1000} onChange={(event) => updateTile(key, 'scents', event.target.value)} />
          </label>
        </fieldset>
      ))}
      <button className="admin-button" disabled={busy || !aboutText.trim() || Object.values(stihii).some((tile) => Object.values(tile).some((text) => !text.trim()))} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить все изменения'}</button>
      {updatedAt && <p>Последнее изменение: {new Date(updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>}
    </div>
  )
}
