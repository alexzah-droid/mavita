'use client'

import { useEffect, useRef } from 'react'

// Точка ПВЗ в нашем нейтральном контракте (как отдаёт /api/cdek).
export type CdekPickupPoint = { code: string; city: string; name: string; address: string }

// Минимальный структурный тип выбранной точки из onChoose виджета (iOffice). Берём
// только нужные поля, чтобы не зависеть от точных имён экспортируемых типов пакета.
type ChosenOffice = { code?: string; city?: string; name?: string; address?: string }

// Карта-виджет СДЭК (@cdek-it/widget). Грузим ДИНАМИЧЕСКИ внутри effect (виджет
// трогает window/DOM — нельзя на этапе SSR). servicePath = наш прокси /api/cdek/widget
// (ключи СДЭК на клиент не уходят). Любой сбой инициализации → onUnavailable,
// и чекаут откатывается на ручной автокомплит города. Только ПВЗ (door скрыт).
export default function CdekWidget({ apiKey, onSelect, onUnavailable, defaultLocation, cityCode }: {
  apiKey: string
  onSelect: (point: CdekPickupPoint) => void
  onUnavailable: () => void
  defaultLocation?: string
  cityCode: number
}) {
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect
  const onUnavailableRef = useRef(onUnavailable); onUnavailableRef.current = onUnavailable

  useEffect(() => {
    let cancelled = false
    let widget: { destroy?: () => void } | undefined
    void (async () => {
      try {
        const mod = (await import('@cdek-it/widget')) as unknown as { Widget?: new (o: unknown) => unknown; default?: new (o: unknown) => unknown }
        const WidgetCtor = mod.Widget ?? mod.default
        if (cancelled) return
        if (!WidgetCtor) { onUnavailableRef.current(); return }
        widget = new WidgetCtor({
          root: 'cdek-map',
          apiKey,
          servicePath: `/api/cdek/widget?city_code=${encodeURIComponent(String(cityCode))}`,
          defaultLocation: defaultLocation && defaultLocation.trim() ? defaultLocation : 'Москва',
          hideDeliveryOptions: { door: true, office: false },
          forceFilters: { type: 'PVZ' },
          onChoose: (_type: unknown, _tariff: unknown, target: ChosenOffice) => {
            if (target && typeof target.code === 'string' && target.code) {
              onSelectRef.current({ code: target.code, city: target.city ?? '', name: target.name ?? '', address: target.address ?? '' })
            }
          },
        }) as { destroy?: () => void }
      } catch {
        if (!cancelled) onUnavailableRef.current()
      }
    })()
    return () => { cancelled = true; try { widget?.destroy?.() } catch { /* виджет мог не иметь destroy */ } }
  }, [apiKey, defaultLocation, cityCode])

  return <div id="cdek-map" className="checkout-cdek-map" />
}
