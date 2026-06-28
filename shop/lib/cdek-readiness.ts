export type ReadinessStatus = 'pass' | 'warn' | 'fail'

export type TimerSnapshot = {
  unit: string
  loadState: string | null
  activeState: string | null
  unitFileState: string | null
  nextElapse: string | null
  lastTrigger: string | null
  error: string | null
}

export type CdekReadinessSnapshot = {
  env: {
    databaseUrlConfigured: boolean
    settingsEncKeyConfigured: boolean
    baseUrl: string | null
    deliveryEnabledLiteral: string | null
  }
  delivery: {
    mode: 'disabled' | 'pickup_required' | 'error'
    cdekEnabled: boolean
    tariffKopecks: number | null
    settingsUpdatedAt: string | null
  }
  credentials: {
    stored: boolean
    probeOk: boolean
    authFailed: boolean
    cityCode: number | null
    pickupPointCount: number | null
    error: string | null
  }
  shipment: {
    autoShipmentEnabled: boolean
    hasShipmentPoint: boolean
    hasSenderName: boolean
    hasSenderPhone: boolean
    hasWebhookUuid: boolean
  }
  timers: {
    cdek: TimerSnapshot | null
    notifications: TimerSnapshot | null
  }
  webhook: {
    url: string | null
    reachable: boolean
    statusCode: number | null
    error: string | null
  }
  db: {
    cdekOrders: number
    ordersWithShipmentUuid: number
    ordersWithWaybill: number
    ordersWithBarcode: number
    webhookEvents: number
    outboxPending: number
    outboxProcessing: number
    outboxFailed: number
    staleProcessing: number
    latestCdekOrderCreatedAt: string | null
    latestShipmentOrderCreatedAt: string | null
    latestWebhookEventAt: string | null
  }
}

export type ReadinessCheck = {
  id: string
  status: ReadinessStatus
  summary: string
  detail: string
}

export type CdekReadinessReport = {
  ready: boolean
  checks: ReadinessCheck[]
}

function timerHealthy(timer: TimerSnapshot | null): boolean {
  return Boolean(
    timer &&
    timer.error == null &&
    timer.loadState === 'loaded' &&
    timer.activeState === 'active' &&
    (timer.unitFileState === 'enabled' || timer.unitFileState === 'static'),
  )
}

export function evaluateCdekReadiness(snapshot: CdekReadinessSnapshot): CdekReadinessReport {
  const checks: ReadinessCheck[] = []

  const add = (id: string, status: ReadinessStatus, summary: string, detail: string) => {
    checks.push({ id, status, summary, detail })
  }

  if (!snapshot.env.databaseUrlConfigured || !snapshot.env.settingsEncKeyConfigured || !snapshot.env.baseUrl) {
    const missing = [
      snapshot.env.databaseUrlConfigured ? null : 'DATABASE_URL',
      snapshot.env.settingsEncKeyConfigured ? null : 'SETTINGS_ENC_KEY',
      snapshot.env.baseUrl ? null : 'NEXT_PUBLIC_BASE_URL',
    ].filter(Boolean).join(', ')
    add('env', 'fail', 'Окружение не готово', `Не заданы обязательные переменные: ${missing}.`)
  } else {
    const deliveryFlag = snapshot.env.deliveryEnabledLiteral ?? '<unset>'
    add('env', 'pass', 'Окружение готово', `DATABASE_URL/SETTINGS_ENC_KEY/NEXT_PUBLIC_BASE_URL заданы; DELIVERY_ENABLED=${deliveryFlag}.`)
  }

  if (!snapshot.delivery.cdekEnabled || snapshot.delivery.mode !== 'pickup_required' || snapshot.delivery.tariffKopecks == null) {
    add(
      'delivery',
      'fail',
      'Checkout не готов к ПВЗ СДЭК',
      `mode=${snapshot.delivery.mode}, cdekEnabled=${snapshot.delivery.cdekEnabled}, tariff=${snapshot.delivery.tariffKopecks ?? 'null'}.`,
    )
  } else {
    add(
      'delivery',
      'pass',
      'Checkout в режиме ПВЗ СДЭК',
      `mode=pickup_required, тариф=${snapshot.delivery.tariffKopecks} коп., settings.updated_at=${snapshot.delivery.settingsUpdatedAt ?? 'unknown'}.`,
    )
  }

  if (!snapshot.credentials.stored) {
    add('credentials', 'fail', 'Ключи СДЭК не сохранены', 'В БД отсутствуют сохранённые credentials перевозчика.')
  } else if (!snapshot.credentials.probeOk) {
    const reason = snapshot.credentials.authFailed ? 'auth_failed' : snapshot.credentials.error ?? 'unavailable'
    add('credentials', 'fail', 'Проверка связи с СДЭК не прошла', `API probe завершился ошибкой: ${reason}.`)
  } else {
    add(
      'credentials',
      'pass',
      'Связь с СДЭК подтверждена',
      `Автокомплит/ПВЗ отвечают: cityCode=${snapshot.credentials.cityCode}, pickupPoints=${snapshot.credentials.pickupPointCount}.`,
    )
  }

  if (
    !snapshot.shipment.autoShipmentEnabled ||
    !snapshot.shipment.hasShipmentPoint ||
    !snapshot.shipment.hasSenderName ||
    !snapshot.shipment.hasSenderPhone
  ) {
    add(
      'shipment-settings',
      'fail',
      'Автоотправка настроена неполно',
      `autoShipmentEnabled=${snapshot.shipment.autoShipmentEnabled}, point=${snapshot.shipment.hasShipmentPoint}, sender=${snapshot.shipment.hasSenderName}, phone=${snapshot.shipment.hasSenderPhone}.`,
    )
  } else {
    add('shipment-settings', 'pass', 'Автоотправка включена', 'Точка сдачи и данные отправителя заполнены.')
  }

  if (!snapshot.shipment.hasWebhookUuid || !snapshot.webhook.reachable) {
    add(
      'webhook',
      'fail',
      'Webhook СДЭК не готов',
      `webhookUuid=${snapshot.shipment.hasWebhookUuid}, endpoint=${snapshot.webhook.url ?? '<unset>'}, http=${snapshot.webhook.statusCode ?? 'n/a'}, error=${snapshot.webhook.error ?? 'none'}.`,
    )
  } else {
    add(
      'webhook',
      'pass',
      'Webhook готов',
      `UUID сохранён в БД; endpoint ${snapshot.webhook.url} отвечает HTTP ${snapshot.webhook.statusCode}.`,
    )
  }

  const timersOk = timerHealthy(snapshot.timers.cdek) && timerHealthy(snapshot.timers.notifications)
  if (!timersOk) {
    add(
      'timers',
      'fail',
      'Systemd-таймеры не готовы',
      `cdek=${snapshot.timers.cdek?.activeState ?? 'n/a'}/${snapshot.timers.cdek?.unitFileState ?? 'n/a'}, notifications=${snapshot.timers.notifications?.activeState ?? 'n/a'}/${snapshot.timers.notifications?.unitFileState ?? 'n/a'}.`,
    )
  } else {
    add(
      'timers',
      'pass',
      'Фоновые таймеры активны',
      `mavita-cdek.timer и mavita-notifications.timer loaded+active; next=${snapshot.timers.cdek?.nextElapse ?? 'unknown'}.`,
    )
  }

  if (snapshot.db.outboxFailed > 0 || snapshot.db.staleProcessing > 0) {
    add(
      'outbox-health',
      'fail',
      'Outbox СДЭК требует внимания',
      `failed=${snapshot.db.outboxFailed}, stale_processing=${snapshot.db.staleProcessing}, pending=${snapshot.db.outboxPending}, processing=${snapshot.db.outboxProcessing}.`,
    )
  } else if (snapshot.db.outboxPending > 0 || snapshot.db.outboxProcessing > 0) {
    add(
      'outbox-health',
      'warn',
      'Outbox СДЭК не пуст',
      `pending=${snapshot.db.outboxPending}, processing=${snapshot.db.outboxProcessing}. Дождитесь опустошения очереди перед финальным вердиктом.`,
    )
  } else {
    add('outbox-health', 'pass', 'Outbox СДЭК чистый', 'Нет failed/stale/pending задач в cdek_task_outbox.')
  }

  const historicalProof =
    snapshot.db.ordersWithShipmentUuid > 0 ||
    snapshot.db.ordersWithWaybill > 0 ||
    snapshot.db.ordersWithBarcode > 0 ||
    snapshot.db.webhookEvents > 0

  if (historicalProof) {
    add(
      'evidence',
      'pass',
      'Есть прод-следы автоотправки',
      `shipment_uuid=${snapshot.db.ordersWithShipmentUuid}, waybill=${snapshot.db.ordersWithWaybill}, barcode=${snapshot.db.ordersWithBarcode}, webhook_events=${snapshot.db.webhookEvents}.`,
    )
  } else {
    const hint = snapshot.db.latestCdekOrderCreatedAt && snapshot.delivery.settingsUpdatedAt &&
      snapshot.db.latestCdekOrderCreatedAt < snapshot.delivery.settingsUpdatedAt
      ? 'Исторические заказы с ПВЗ предшествуют включению автоотправки; следующий реальный заказ станет первым подтверждением.'
      : 'В БД пока нет прод-следов auto-shipment/webhook; следующий реальный заказ должен подтвердить контур.'
    add(
      'evidence',
      'warn',
      'Контур готов конфигурационно, но ещё не доказан новым заказом',
      hint,
    )
  }

  return { ready: checks.every((check) => check.status !== 'fail'), checks }
}
