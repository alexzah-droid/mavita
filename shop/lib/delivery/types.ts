// Общий контракт перевозчика ПВЗ. Колонки заказа нейтральны; провайдеры (СДЭК) —
// реализации одного интерфейса, чтобы checkout/createOrder/прокси не дублировали
// логику и новый перевозчик добавлялся как ещё одна реализация.

export type PickupPoint = { code: string; city: string; name: string; address: string; workTime?: string }

// Credentials передаются провайдеру ЯВНО (он не ходит в БД и не читает env):
// caller достаёт runtime/draft ключи из store-settings и отдаёт сюда. fingerprint
// (sha256 ключей) используется провайдером для кэша токена — смена ключа его
// инвалидирует без межпроцессного сигнала.
export type DeliveryCredentials = { clientId: string; secret: string; fingerprint?: string }

export interface CarrierProvider {
  listPickupPoints(city?: string): Promise<PickupPoint[]>
  getPickupPoint(code: string): Promise<PickupPoint>
}

/**
 * Единая ошибка доступа к ПВЗ: unavailable=true → 503 (сеть/таймаут/нет ключей),
 * иначе 400. authFailed=true означает, что перевозчик ответил 401/403 (неверные
 * ключи) — используется endpoint-ом «Проверить связь» для различения auth_failed.
 */
export class DeliveryProviderError extends Error {
  constructor(message: string, public unavailable = false, public authFailed = false) { super(message); this.name = 'DeliveryProviderError' }
}
