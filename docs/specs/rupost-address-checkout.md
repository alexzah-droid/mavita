# Почта России — адресный checkout

**Статус:** планируемая фаза после `rupost-api-revalidation`.  
**Актуализировано:** 2026-06-30.  
**Зависит от:** [rupost-api-revalidation.md](rupost-api-revalidation.md).  
**Не реализовано в коде.**

---

## Цель

Добавить выключаемый способ доставки `rupost` с адресным вводом и server-side
snapshot до оплаты. Покупатель заранее оплачивает товары и доставку через
Робокассу; наложенный платёж не используется.

Эта фаза не создаёт партии и не печатает формы. После оплаты можно либо
оставить ручной операционный процесс, либо подключить worker из
[rupost-batches-admin.md](rupost-batches-admin.md) отдельной задачей.

---

## Scope

- Новый carrier `rupost`.
- Новый delivery method `rupost_address`.
- Настройки в `store_settings`: включение, фиксированный тариф, зашифрованные
  API token/user auth key, данные отправителя.
- Публичный endpoint нормализации адреса с rate-limit.
- Checkout UI для адреса и индекса.
- Server-side re-normalization при создании заказа.
- Snapshot адреса в `orders`.
- `PRICE_CHANGED` при расхождении тарифа.

Не в scope:

- live-расчёт тарифа;
- создание отправления у Почты;
- партии, Ф7п, Ф103, check-in;
- tracking API;
- возвраты;
- наложенный платёж.

---

## Миграции

Не использовать номер `013`: он уже занят `013_drop_ozon.sql`. Новая миграция
должна идти следующим свободным номером на момент реализации.

Минимальные изменения:

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address_snapshot JSONB;

-- CHECK: при rupost_address address + postal_code + snapshot обязательны.
-- CHECK: delivery_postal_code либо NULL, либо 6 цифр.
-- CHECK: delivery_method допускает cdek_pickup/cdek и rupost_address/rupost.
-- Не возвращать ozon_pickup в constraint.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS rupost_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rupost_delivery_kopecks INTEGER,
  ADD COLUMN IF NOT EXISTS rupost_api_token_enc BYTEA,
  ADD COLUMN IF NOT EXISTS rupost_user_auth_key_enc BYTEA,
  ADD COLUMN IF NOT EXISTS rupost_sender_name TEXT,
  ADD COLUMN IF NOT EXISTS rupost_sender_address TEXT,
  ADD COLUMN IF NOT EXISTS rupost_sender_postal_code TEXT;

CREATE TABLE IF NOT EXISTS rupost_normalize_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  session_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Store settings

Текущий `Carrier = 'cdek'` нужно расширять осознанно, потому что `rupost` не
является pickup-provider.

Целевая модель:

```typescript
type Carrier = 'cdek' | 'rupost'
type CarrierMode = 'pickup' | 'address'

type ActiveCarrier =
  | { carrier: 'cdek'; mode: 'pickup'; deliveryKopecks: number }
  | { carrier: 'rupost'; mode: 'address'; deliveryKopecks: number }
```

`resolveDeliveryMode()` должен fail-closed:

- включённый `rupost` без тарифа, токена, user key или отправителя → `error`;
- расшифровка секрета упала → `error`;
- выключенный `rupost` не показывается в checkout;
- при единственном активном carrier UI не показывает лишний переключатель.

---

## Нормализация адреса

Endpoint: `POST /api/checkout/rupost/normalize`.

Правила:

- адрес + индекс не длиннее 300 символов;
- rate-limit по IP и optional session key, общий между процессами через БД;
- timeout к Почте 5 секунд;
- наружу только безопасные пользовательские сообщения;
- в доменные таблицы endpoint ничего не пишет.

Ответ:

```typescript
type NormalizeResult =
  | { ok: true; address: string; postalCode: string; snapshot: RupostAddressSnapshot }
  | { ok: false; message: string }

type RupostAddressSnapshot = {
  index: string
  region: string | null
  place: string | null
  street: string | null
  house: string | null
  room: string | null
  qualityCode: string
  validationCode: string
}
```

При создании заказа сервер повторно вызывает нормализацию и сравнивает
критичные поля с присланным snapshot. Клиентский snapshot — только optimistic
state, не источник истины.

---

## Checkout

Контакты остаются общими:

- телефон получателя;
- ФИО получателя;
- email покупателя.

Для `rupost` дополнительно:

- адрес одной строкой;
- индекс;
- кнопка проверки адреса;
- подтверждённый нормализованный адрес.

Кнопка оплаты недоступна, пока адрес не нормализован. При переключении
перевозчика адресный snapshot сбрасывается.

---

## Создание заказа

`POST /api/robokassa/init` должен принимать discriminated union:

```typescript
type DeliveryInput =
  | { method: 'cdek_pickup'; pickupPointCode: string; expectedDeliveryKopecks: number }
  | { method: 'rupost_address'; address: string; postalCode: string; snapshot: RupostAddressSnapshot; expectedDeliveryKopecks: number }
```

Для `rupost_address`:

1. Проверить, что carrier активен.
2. Сравнить `expectedDeliveryKopecks` с серверным тарифом.
3. Повторно нормализовать адрес на сервере.
4. Сохранить `delivery_address`, `delivery_postal_code`,
   `delivery_address_snapshot`; `pickup_point_*` оставить `NULL`.
5. Сохранить `delivery_kopecks` как immutable snapshot.

---

## Acceptance criteria

- [ ] При включённом `rupost` без полной настройки checkout возвращает 503.
- [ ] Без нормализованного адреса нельзя перейти к оплате.
- [ ] Подмена тарифа в браузере даёт `409 PRICE_CHANGED`.
- [ ] Подмена адресного snapshot даёт `400 ADDRESS_INVALID`.
- [ ] В заказе нет `pickup_point_*` для `rupost_address`.
- [ ] `items_kopecks + delivery_kopecks = total_kopecks` сохраняется.
- [ ] Публичный normalize endpoint rate-limited и не пишет PII в логи.
