import { describe, expect, it } from 'vitest'
import { evaluateCdekReadiness, type CdekReadinessSnapshot } from '@/lib/cdek-readiness'

function baseSnapshot(): CdekReadinessSnapshot {
  return {
    env: {
      databaseUrlConfigured: true,
      settingsEncKeyConfigured: true,
      baseUrl: 'https://mavita.ru',
      deliveryEnabledLiteral: 'true',
    },
    delivery: {
      mode: 'pickup_required',
      cdekEnabled: true,
      tariffKopecks: 40000,
      settingsUpdatedAt: '2026-06-26T16:46:38.595Z',
    },
    credentials: {
      stored: true,
      probeOk: true,
      authFailed: false,
      cityCode: 44,
      pickupPointCount: 424,
      error: null,
    },
    shipment: {
      autoShipmentEnabled: true,
      hasShipmentPoint: true,
      hasSenderName: true,
      hasSenderPhone: true,
      hasWebhookUuid: true,
    },
    timers: {
      cdek: {
        unit: 'mavita-cdek.timer',
        loadState: 'loaded',
        activeState: 'active',
        unitFileState: 'enabled',
        nextElapse: 'Sun 2026-06-28 12:15:00 MSK',
        lastTrigger: 'Sun 2026-06-28 12:14:05 MSK',
        error: null,
      },
      notifications: {
        unit: 'mavita-notifications.timer',
        loadState: 'loaded',
        activeState: 'active',
        unitFileState: 'enabled',
        nextElapse: 'Sun 2026-06-28 12:15:00 MSK',
        lastTrigger: 'Sun 2026-06-28 12:14:05 MSK',
        error: null,
      },
    },
    webhook: {
      url: 'https://mavita.ru/api/cdek/webhook',
      reachable: true,
      statusCode: 405,
      error: null,
    },
    db: {
      cdekOrders: 1,
      ordersWithShipmentUuid: 0,
      ordersWithWaybill: 0,
      ordersWithBarcode: 0,
      webhookEvents: 0,
      outboxPending: 0,
      outboxProcessing: 0,
      outboxFailed: 0,
      staleProcessing: 0,
      latestCdekOrderCreatedAt: '2026-06-24T10:53:04.492Z',
      latestShipmentOrderCreatedAt: null,
      latestWebhookEventAt: null,
    },
  }
}

describe('evaluateCdekReadiness', () => {
  it('treats config-complete but unproven auto-shipment as ready with a warning', () => {
    const report = evaluateCdekReadiness(baseSnapshot())
    expect(report.ready).toBe(true)
    expect(report.checks.find((check) => check.id === 'evidence')?.status).toBe('warn')
    expect(report.checks.find((check) => check.id === 'evidence')?.detail).toContain('следующий реальный заказ')
  })

  it('fails when webhook/timers/credentials are not ready', () => {
    const snapshot = baseSnapshot()
    snapshot.credentials.probeOk = false
    snapshot.credentials.error = 'auth_failed'
    snapshot.shipment.hasWebhookUuid = false
    snapshot.webhook.reachable = false
    snapshot.timers.cdek!.activeState = 'inactive'
    const report = evaluateCdekReadiness(snapshot)
    expect(report.ready).toBe(false)
    expect(report.checks.find((check) => check.id === 'credentials')?.status).toBe('fail')
    expect(report.checks.find((check) => check.id === 'webhook')?.status).toBe('fail')
    expect(report.checks.find((check) => check.id === 'timers')?.status).toBe('fail')
  })
})
