import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyModeration, decideItemAction, isMutatingOperation, moderationMaxAgeHours, catalogSyncEnabled } from '@/lib/ozon-fbs-sync'
import type { OzonProfile } from '@/lib/ozon-fbs-profile'

function profile(over: Partial<OzonProfile> = {}): OzonProfile {
  return {
    productId: 9, enabled: true, offerId: 'mavita-9', fbsStockQuantity: 5,
    descriptionCategoryId: 17028739, typeId: 95741, barcode: '460', weightGrams: 1000, lengthMm: 120, widthMm: 120, heightMm: 120,
    attributes: [], ozonProductId: 5189655669, importTaskId: null, remoteState: 'hidden_confirmed', moderationStatus: 'approved',
    contentSyncedAt: null, stockSyncedAt: null, moderationStartedAt: null, lastModerationCheckedAt: null,
    manualHiddenConfirmedAt: '2026-06-22T00:00:00Z', manualHiddenConfirmedByLoginAt: 7, hiddenVerifiedAt: null, hiddenVerificationMethod: null,
    contentDirty: false, stockDirty: true, lastStockSentQuantity: 0, complianceStatus: 'ready', complianceNote: null,
    lastErrorCode: null, lastErrorMessage: null, createdAt: '2026-06-22T00:00:00Z', updatedAt: '2026-06-22T00:00:00Z', ...over,
  }
}
// stale вычисляется в SQL (loadProfileForUpdate) и передаётся булевым флагом.
const FRESH = false
const STALE = true

describe('decideItemAction — content_import', () => {
  it('enabled, не pending → import (zeroFirst если был остаток)', () => {
    expect(decideItemAction('content_import', profile({ remoteState: 'not_synced', lastStockSentQuantity: 0 }), FRESH)).toEqual({ action: 'import', zeroFirst: false })
    expect(decideItemAction('content_import', profile({ remoteState: 'hidden_confirmed', lastStockSentQuantity: 3 }), FRESH)).toEqual({ action: 'import', zeroFirst: true })
  })
  it('выключенный профиль → skip', () => {
    expect(decideItemAction('content_import', profile({ enabled: false }), FRESH).action).toBe('skip')
  })
  it('уже pending → skip', () => {
    expect(decideItemAction('content_import', profile({ remoteState: 'pending' }), FRESH)).toMatchObject({ action: 'skip', reason: 'already_pending' })
  })
  it('профиль изменился после выборки (stale) → skip', () => {
    expect(decideItemAction('content_import', profile({ remoteState: 'not_synced' }), STALE)).toMatchObject({ action: 'skip', reason: 'stale' })
  })
})

describe('decideItemAction — stock_update (execution-time re-check)', () => {
  it('hidden_confirmed + подтверждение + enabled → set_stock с recordHidden', () => {
    expect(decideItemAction('stock_update', profile(), FRESH)).toEqual({ action: 'set_stock', stock: 5, recordHidden: true })
  })
  it('подтверждение скрытия сброшено (re-import) → skip, без ненулевого остатка', () => {
    expect(decideItemAction('stock_update', profile({ manualHiddenConfirmedAt: null }), FRESH)).toMatchObject({ action: 'skip', reason: 'not_hidden_confirmed' })
  })
  it('не hidden_confirmed → skip', () => {
    expect(decideItemAction('stock_update', profile({ remoteState: 'awaiting_manual_hide' }), FRESH).action).toBe('skip')
  })
  it('выключенный → skip', () => {
    expect(decideItemAction('stock_update', profile({ enabled: false }), FRESH).action).toBe('skip')
  })
  it('контент изменился после выборки (stale) → skip, не шлём остаток', () => {
    expect(decideItemAction('stock_update', profile(), STALE)).toMatchObject({ action: 'skip', reason: 'stale' })
  })
})

describe('decideItemAction — zero_stock', () => {
  it('disabled с ozon_product_id → set_stock 0', () => {
    expect(decideItemAction('zero_stock', profile({ remoteState: 'disabled', enabled: false }), FRESH)).toEqual({ action: 'set_stock', stock: 0, recordHidden: false })
  })
  it('никогда не импортировался (нет ozon_product_id) → skip', () => {
    expect(decideItemAction('zero_stock', profile({ ozonProductId: null }), FRESH)).toMatchObject({ action: 'skip', reason: 'never_imported' })
  })
})

describe('decideItemAction — moderation_poll', () => {
  it('awaiting_moderation → poll', () => {
    expect(decideItemAction('moderation_poll', profile({ remoteState: 'awaiting_moderation' }), FRESH)).toEqual({ action: 'poll' })
  })
  it('иное состояние → skip', () => {
    expect(decideItemAction('moderation_poll', profile({ remoteState: 'hidden_confirmed' }), FRESH).action).toBe('skip')
  })
})

describe('classifyModeration', () => {
  it('MODERATED/approved → approved', () => { expect(classifyModeration('moderated')).toBe('approved'); expect(classifyModeration('approved')).toBe('approved') })
  it('declined/failed → rejected', () => { expect(classifyModeration('declined')).toBe('rejected'); expect(classifyModeration('moderation_failed')).toBe('rejected') })
  it('пусто/в процессе → pending', () => { expect(classifyModeration(null)).toBe('pending'); expect(classifyModeration('processing')).toBe('pending') })
})

describe('флаги окружения', () => {
  beforeEach(() => { delete process.env.OZON_CATALOG_SYNC_ENABLED; delete process.env.OZON_MODERATION_MAX_AGE_HOURS })
  afterEach(() => { delete process.env.OZON_CATALOG_SYNC_ENABLED; delete process.env.OZON_MODERATION_MAX_AGE_HOURS })
  it('catalogSyncEnabled требует literal "true"', () => {
    expect(catalogSyncEnabled()).toBe(false)
    process.env.OZON_CATALOG_SYNC_ENABLED = 'true'; expect(catalogSyncEnabled()).toBe(true)
    process.env.OZON_CATALOG_SYNC_ENABLED = '1'; expect(catalogSyncEnabled()).toBe(false)
  })
  it('isMutatingOperation: poll read-only', () => {
    expect(isMutatingOperation('content_import')).toBe(true)
    expect(isMutatingOperation('stock_update')).toBe(true)
    expect(isMutatingOperation('zero_stock')).toBe(true)
    expect(isMutatingOperation('moderation_poll')).toBe(false)
  })
  it('moderationMaxAgeHours: дефолт 168 при мусоре', () => {
    expect(moderationMaxAgeHours()).toBe(168)
    process.env.OZON_MODERATION_MAX_AGE_HOURS = '72'; expect(moderationMaxAgeHours()).toBe(72)
    process.env.OZON_MODERATION_MAX_AGE_HOURS = 'oops'; expect(moderationMaxAgeHours()).toBe(168)
    process.env.OZON_MODERATION_MAX_AGE_HOURS = '-5'; expect(moderationMaxAgeHours()).toBe(168)
  })
})
