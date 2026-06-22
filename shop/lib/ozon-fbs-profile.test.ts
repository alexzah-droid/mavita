import { describe, expect, it } from 'vitest'
import {
  buildImportItem, buildOzonImageUrls, canConfirmHidden, canImport, canSetNonZeroStock,
  computeReadiness, OzonImageError, offerIdFor, validateOzonProfileInput, type ReadinessContext,
} from '@/lib/ozon-fbs-profile'

describe('offerIdFor', () => {
  it('детерминирован по product_id', () => { expect(offerIdFor(9)).toBe('mavita-9'); expect(offerIdFor(123)).toBe('mavita-123') })
})

describe('validateOzonProfileInput', () => {
  it('отрицательный остаток отклоняется', () => {
    expect(validateOzonProfileInput({ fbsStockQuantity: -1 }).errors).toContain('FBS-остаток — целое число ≥ 0')
  })
  it('категория задаётся парой', () => {
    expect(validateOzonProfileInput({ descriptionCategoryId: 17028739 }).errors.length).toBeGreaterThan(0)
    const ok = validateOzonProfileInput({ descriptionCategoryId: 17028739, typeId: 95741 })
    expect(ok.errors).toEqual([]); expect(ok.value?.typeId).toBe(95741)
  })
  it('категорию можно очистить парой null', () => {
    const r = validateOzonProfileInput({ descriptionCategoryId: null, typeId: null })
    expect(r.errors).toEqual([]); expect(r.value).toMatchObject({ descriptionCategoryId: null, typeId: null })
  })
  it('габариты — положительные целые', () => {
    expect(validateOzonProfileInput({ weightGrams: 0 }).errors.length).toBeGreaterThan(0)
    expect(validateOzonProfileInput({ heightMm: -5 }).errors.length).toBeGreaterThan(0)
    expect(validateOzonProfileInput({ weightGrams: 1000, lengthMm: 120, widthMm: 120, heightMm: 120 }).errors).toEqual([])
  })
  it('атрибут: ровно одно из dictionaryValueId / value', () => {
    expect(validateOzonProfileInput({ attributes: [{ attributeId: 85, complexId: 0, values: [{}] }] }).errors.length).toBeGreaterThan(0)
    expect(validateOzonProfileInput({ attributes: [{ attributeId: 85, complexId: 0, values: [{ dictionaryValueId: 5, value: 'x' }] }] }).errors.length).toBeGreaterThan(0)
    const ok = validateOzonProfileInput({ attributes: [{ attributeId: 85, complexId: 0, values: [{ dictionaryValueId: 126745801 }] }, { attributeId: 9048, complexId: 0, values: [{ value: 'Морской камень' }] }] })
    expect(ok.errors).toEqual([]); expect(ok.value?.attributes).toHaveLength(2)
  })
  it('неизвестное поле (например offerId) отклоняется', () => {
    expect(validateOzonProfileInput({ offerId: 'hack' }).errors[0]).toContain('Неизвестное поле')
  })
  it('compliance статус валидируется', () => {
    expect(validateOzonProfileInput({ complianceStatus: 'bogus' as never }).errors.length).toBeGreaterThan(0)
    expect(validateOzonProfileInput({ complianceStatus: 'ready' }).value?.complianceStatus).toBe('ready')
  })
})

describe('buildOzonImageUrls', () => {
  it('строит публичные https-URL из base + uploads/products', () => {
    expect(buildOzonImageUrls('https://mavita.ru', ['005/005-01.png', '/005-02.jpg'])).toEqual([
      'https://mavita.ru/uploads/products/005/005-01.png',
      'https://mavita.ru/uploads/products/005-02.jpg',
    ])
  })
  it('localhost запрещён', () => { expect(() => buildOzonImageUrls('http://localhost:3000', ['a.jpg'])).toThrow(OzonImageError) })
  it('не-https запрещён', () => { expect(() => buildOzonImageUrls('http://mavita.ru', ['a.jpg'])).toThrow(OzonImageError) })
  it('пустой base запрещён', () => { expect(() => buildOzonImageUrls(undefined, ['a.jpg'])).toThrow(OzonImageError) })
})

function readyCtx(over: Partial<ReadinessContext> = {}): ReadinessContext {
  return {
    enabled: true, name: 'Свеча', description: 'Описание', effectivePriceKopecks: 90000, imageCount: 3,
    profile: { descriptionCategoryId: 17028739, typeId: 95741, barcode: null, weightGrams: 1000, lengthMm: 120, widthMm: 120, heightMm: 120, attributes: [{ attributeId: 85, complexId: 0, values: [{ dictionaryValueId: 1 }] }], ozonProductId: null, complianceStatus: 'ready' },
    warehouseId: 42, baseUrl: 'https://mavita.ru', ...over,
  }
}

describe('computeReadiness', () => {
  it('полный профиль — без ошибок', () => { expect(computeReadiness(readyCtx())).toEqual([]) })
  it('нет изображений → ошибка', () => { expect(computeReadiness(readyCtx({ imageCount: 0 }))).toContain('Нужно хотя бы одно изображение') })
  it('нет цены → ошибка', () => { expect(computeReadiness(readyCtx({ effectivePriceKopecks: 0 }))).toContain('Не задана цена') })
  it('нет категории → ошибка', () => { expect(computeReadiness(readyCtx({ profile: { ...readyCtx().profile, descriptionCategoryId: null, typeId: null } })).some((e) => e.includes('категория'))).toBe(true) })
  it('нет габаритов → ошибка', () => { expect(computeReadiness(readyCtx({ profile: { ...readyCtx().profile, heightMm: null } })).some((e) => e.includes('габарита'))).toBe(true) })
  it('первый import без штрихкода допустим (ozonProductId null)', () => { expect(computeReadiness(readyCtx())).toEqual([]) })
  it('повторный import без штрихкода запрещён (ozonProductId задан)', () => {
    expect(computeReadiness(readyCtx({ profile: { ...readyCtx().profile, ozonProductId: 5189655669, barcode: null } }))).toContain('Для повторного import нужен штрихкод')
  })
  it('нет склада → ошибка', () => { expect(computeReadiness(readyCtx({ warehouseId: null }))).toContain('Не выбран FBS-склад Ozon') })
  it('localhost base (даже https) → ошибка', () => { expect(computeReadiness(readyCtx({ baseUrl: 'https://localhost:3000' })).some((e) => e.includes('localhost'))).toBe(true) })
  it('http base → ошибка HTTPS', () => { expect(computeReadiness(readyCtx({ baseUrl: 'http://mavita.ru' })).some((e) => e.includes('HTTPS'))).toBe(true) })
  it('compliance не ready → ошибка', () => { expect(computeReadiness(readyCtx({ profile: { ...readyCtx().profile, complianceStatus: 'not_checked' } })).some((e) => e.includes('готовность'))).toBe(true) })
  it('compliance blocked → ошибка', () => { expect(computeReadiness(readyCtx({ profile: { ...readyCtx().profile, complianceStatus: 'blocked' } })).some((e) => e.includes('готовность'))).toBe(true) })
  it('пустые обязательные атрибуты категории → ошибка', () => {
    expect(computeReadiness(readyCtx({ requiredAttributeIds: [85, 8229] })).some((e) => e.includes('8229'))).toBe(true)
  })
})

describe('buildImportItem', () => {
  it('детерминированный payload без флага видимости', () => {
    const item = buildImportItem({
      offerId: 'mavita-9', name: 'Свеча', description: 'D', descriptionCategoryId: 17028739, typeId: 95741,
      attributes: [{ attributeId: 85, complexId: 0, values: [{ dictionaryValueId: 126745801 }] }, { attributeId: 9048, complexId: 0, values: [{ value: 'Морской камень' }] }],
      imageUrls: ['https://mavita.ru/uploads/products/005/005-01.png'], priceRubles: '900.00',
      weightGrams: 1000, lengthMm: 100, widthMm: 110, heightMm: 120, barcode: null,
    })
    expect(item).toMatchObject({ offer_id: 'mavita-9', price: '900.00', currency_code: 'RUB', weight: 1000, weight_unit: 'g', height: 120, width: 110, depth: 100, dimension_unit: 'mm' })
    expect(item).not.toHaveProperty('visibility')
    expect(item).not.toHaveProperty('barcode')
    expect((item.attributes as unknown[])[0]).toEqual({ id: 85, complex_id: 0, values: [{ dictionary_value_id: 126745801 }] })
    expect((item.attributes as unknown[])[1]).toEqual({ id: 9048, complex_id: 0, values: [{ value: 'Морской камень' }] })
  })
  it('штрихкод включается, когда задан', () => {
    const item = buildImportItem({ offerId: 'mavita-9', name: 'a', description: 'b', descriptionCategoryId: 1, typeId: 2, attributes: [], imageUrls: [], priceRubles: '1.00', weightGrams: 1, lengthMm: 1, widthMm: 1, heightMm: 1, barcode: '4600000000017' })
    expect(item.barcode).toBe('4600000000017')
  })
})

describe('state predicates', () => {
  it('canImport: enabled и не pending', () => {
    expect(canImport({ enabled: true, remoteState: 'not_synced' })).toBe(true)
    expect(canImport({ enabled: true, remoteState: 'pending' })).toBe(false)
    expect(canImport({ enabled: false, remoteState: 'not_synced' })).toBe(false)
  })
  it('canConfirmHidden: только awaiting_manual_hide', () => {
    expect(canConfirmHidden({ remoteState: 'awaiting_manual_hide' })).toBe(true)
    expect(canConfirmHidden({ remoteState: 'awaiting_moderation' })).toBe(false)
  })
  it('canSetNonZeroStock: hidden_confirmed + подтверждение + enabled', () => {
    expect(canSetNonZeroStock({ enabled: true, remoteState: 'hidden_confirmed', manualHiddenConfirmedAt: '2026-06-22T00:00:00Z' })).toBe(true)
    expect(canSetNonZeroStock({ enabled: true, remoteState: 'hidden_confirmed', manualHiddenConfirmedAt: null })).toBe(false)
    expect(canSetNonZeroStock({ enabled: true, remoteState: 'awaiting_manual_hide', manualHiddenConfirmedAt: '2026-06-22T00:00:00Z' })).toBe(false)
    expect(canSetNonZeroStock({ enabled: false, remoteState: 'hidden_confirmed', manualHiddenConfirmedAt: '2026-06-22T00:00:00Z' })).toBe(false)
  })
})
