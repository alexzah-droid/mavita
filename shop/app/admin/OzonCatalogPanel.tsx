'use client'
// Панель «Доставка → Ozon»: выбор FBS-склада, сводка/действия по техническому
// каталогу товаров и статус синхронизации ПВЗ. HTTP к Ozon идёт через серверные
// endpoints; ключи в браузер не попадают.
import { useEffect, useState } from 'react'

type Warehouse = { warehouseId: number; name: string; type: string | null; status: string | null }
type Summary = { enabled: number; awaitingModeration: number; awaitingManualHide: number; hiddenConfirmed: number; invalid: number; failed: number; disabled: number; contentDirty: number; stockDirty: number; zeroStock: number; lastContentSyncedAt: string | null; lastStockSyncedAt: string | null }
type Pickup = { status: string; lastSuccessAt: string | null; lastSuccessCount: number }
type Run = { id: string; operation: string; status: string; totalItems: number; succeededItems: number; failedItems: number; summary: string | null; createdAt?: string }
type Status = { summary: Summary; warehouse: { warehouseId: number; name: string | null } | null; pickup: Pickup; catalogSyncEnabled: boolean; orderFlowEnabled: boolean; recentRuns: Run[] }
type RunItem = { productId: number; offerId: string | null; status: string; attempts: number; errorCode: string | null; errorMessage: string | null; remoteState: string | null; moderationStatus: string | null; manualHiddenConfirmedAt: string | null; hiddenVerificationMethod: string | null; updatedAt: string | null }
type ReadinessRow = { productId: number; offerId: string; ready: boolean; errors: string[] }

const age = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU') : '—')

export default function OzonCatalogPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null)
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const [runItems, setRunItems] = useState<RunItem[] | null>(null)
  const [readiness, setReadiness] = useState<ReadinessRow[] | null>(null)

  const reload = () => fetch('/api/admin/ozon/catalog-status').then((r) => (r.ok ? r.json() : null)).then((s) => { if (s) { setStatus(s); setSelected(s.warehouse?.warehouseId?.toString() ?? '') } })
  useEffect(() => { reload().catch(() => setMessage('Не удалось загрузить статус Ozon')) }, [])

  async function refreshRun(runId: string) {
    const res = await fetch(`/api/admin/ozon/catalog-sync/${runId}`)
    const data = await res.json().catch(() => null)
    if (res.ok) { setRun(data.run); setRunItems(data.items) }
  }
  async function runReadiness() {
    setBusy(true); setMessage('')
    const res = await fetch('/api/admin/ozon/catalog-readiness')
    const data = await res.json().catch(() => null); setBusy(false)
    if (res.ok) { setReadiness(data.rows); setMessage(`Проверено профилей: ${data.rows.length}`) }
    else setMessage(data?.error?.messages?.join('; ') ?? 'Не удалось проверить готовность')
  }

  async function loadWarehouses() {
    setBusy(true); setMessage('')
    const res = await fetch('/api/admin/ozon/warehouses')
    const data = await res.json().catch(() => null); setBusy(false)
    if (res.ok) setWarehouses(data.warehouses)
    else setMessage(data?.error?.messages?.join('; ') ?? 'Не удалось получить склады')
  }
  async function saveWarehouse() {
    setBusy(true); setMessage('')
    const res = await fetch('/api/admin/settings/delivery/ozon-warehouse', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warehouseId: selected ? Number(selected) : null }) })
    const data = await res.json().catch(() => null); setBusy(false)
    if (res.ok) { setMessage('Склад сохранён'); reload() }
    else setMessage(data?.error?.messages?.join('; ') ?? 'Не удалось сохранить склад')
  }

  async function post(url: string, label: string, body?: unknown) {
    setBusy(true); setMessage('')
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    const data = await res.json().catch(() => null); setBusy(false)
    if (res.ok && data.run) {
      setRun(data.run); setRunItems(null)
      setMessage(`${label}: run поставлен (${data.run.status}) — исполнит фоновый worker (npm run ozon:catalog-worker)`) ; reload()
      refreshRun(data.run.id)
    } else setMessage(data?.error?.messages?.join('; ') ?? `${label}: ошибка`)
  }

  if (!status) return <fieldset className="admin-card"><legend>Ozon</legend><p>{message || 'Загрузка…'}</p></fieldset>
  const s = status.summary

  return (
    <fieldset className="admin-card">
      <legend>Ozon Доставка</legend>
      {!status.orderFlowEnabled && <p className="admin-warning">ПВЗ синхронизированы, но оформление отправления ещё не реализовано — Ozon не предлагается покупателю.</p>}
      {!status.catalogSyncEnabled && <p className="admin-hint">OZON_CATALOG_SYNC_ENABLED выключен: доступны только dry-run, чтение складов/категорий и проверка модерации.</p>}

      <h3>FBS-склад Ozon</h3>
      <p className="admin-hint">Текущий: {status.warehouse ? `${status.warehouse.name ?? ''} (#${status.warehouse.warehouseId})` : 'не выбран'}</p>
      <div className="admin-actions">
        <button type="button" onClick={loadWarehouses} disabled={busy}>Загрузить список складов</button>
        {warehouses && (
          <>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">— не выбран —</option>
              {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name} · {w.type} · {w.status} (#{w.warehouseId})</option>)}
            </select>
            <button type="button" onClick={saveWarehouse} disabled={busy}>Сохранить склад</button>
          </>
        )}
      </div>

      <h3>Товары МАВИТА → Ozon</h3>
      <ul className="admin-summary">
        <li>enabled: {s.enabled}</li>
        <li>ожидают модерации: {s.awaitingModeration}</li>
        <li>ждут ручного скрытия: {s.awaitingManualHide}</li>
        <li>скрыты (подтверждено): {s.hiddenConfirmed}</li>
        <li>требуют content-sync: {s.contentDirty}</li>
        <li>требуют stock-sync: {s.stockDirty}</li>
        <li>не готовы / ошибка: {s.invalid} / {s.failed}</li>
        <li>нулевой остаток: {s.zeroStock}</li>
      </ul>
      <p className="admin-hint">последний content-import: {age(s.lastContentSyncedAt)} · последний stock-update: {age(s.lastStockSyncedAt)}</p>
      <p className="admin-warning">⚠️ Массовая загрузка делает карточки публичными с остатком 0. После модерации скройте каждую вручную в ЛК и подтвердите скрытие — только затем обновляйте остатки.</p>
      <div className="admin-actions">
        <button type="button" onClick={runReadiness} disabled={busy}>Проверить готовность всех</button>
        <button type="button" onClick={() => post('/api/admin/ozon/catalog-sync', 'Загрузка готовых', { confirm: true })} disabled={busy || !status.catalogSyncEnabled}>Загрузить готовые в Ozon</button>
        <button type="button" onClick={() => post('/api/admin/ozon/catalog-moderation-poll', 'Проверка модерации')} disabled={busy}>Проверить модерацию (все)</button>
        <button type="button" onClick={() => post('/api/admin/ozon/catalog-stock-sync', 'Обновление остатков')} disabled={busy || !status.catalogSyncEnabled}>Обновить остатки (только скрытых)</button>
      </div>

      {readiness && (
        <table className="admin-table"><thead><tr><th>offer_id</th><th>готов</th><th>чего не хватает</th></tr></thead>
          <tbody>{readiness.map((r) => <tr key={r.productId}><td>{r.offerId}</td><td>{r.ready ? '✓' : '—'}</td><td>{r.errors.join('; ')}</td></tr>)}</tbody>
        </table>
      )}

      {(status.recentRuns?.length > 0 || run) && (
        <div className="admin-run">
          <h4>Запуски синхронизации</h4>
          <table className="admin-table"><thead><tr><th>run</th><th>операция</th><th>статус</th><th>ok/ошибок</th><th>когда</th><th /></tr></thead>
            <tbody>{status.recentRuns?.map((r) => (
              <tr key={r.id}>
                <td><code>{r.id.slice(0, 8)}</code></td><td>{r.operation}</td><td>{r.status}</td><td>{r.succeededItems}/{r.failedItems}</td><td>{age(r.createdAt ?? null)}</td>
                <td><button type="button" onClick={() => refreshRun(r.id)} disabled={busy}>детали</button></td>
              </tr>
            ))}</tbody>
          </table>
          {run && runItems && (
            <>
              <p className="admin-hint">Детали run <code>{run.id}</code> · {run.operation} · <strong>{run.status}</strong> · ok={run.succeededItems} ошибок={run.failedItems}{' '}
                <button type="button" onClick={() => refreshRun(run.id)} disabled={busy}>обновить</button></p>
              <table className="admin-table"><thead><tr><th>offer_id</th><th>позиция</th><th>этап профиля</th><th>модерация</th><th>скрытие</th><th>попыток</th><th>ошибка</th><th>обновлён</th></tr></thead>
                <tbody>{runItems.map((i) => (
                  <tr key={i.productId}>
                    <td>{i.offerId ?? i.productId}</td><td>{i.status}</td><td>{i.remoteState ?? '—'}</td><td>{i.moderationStatus ?? '—'}</td>
                    <td>{i.manualHiddenConfirmedAt ? `подтв.${i.hiddenVerificationMethod ? ` (${i.hiddenVerificationMethod})` : ''}` : '—'}</td>
                    <td>{i.attempts}</td><td>{i.errorMessage ?? ''}</td><td>{age(i.updatedAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>
          )}
        </div>
      )}

      <h3>ПВЗ Ozon → магазин</h3>
      <p className="admin-hint">статус: {status.pickup.status} · последняя успешная: {age(status.pickup.lastSuccessAt)} · активных точек: {status.pickup.lastSuccessCount}</p>

      {message && <p className="admin-message">{message}</p>}
    </fieldset>
  )
}
