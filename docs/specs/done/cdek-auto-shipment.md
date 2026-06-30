# Спека: автосоздание отправления СДЭК после оплаты

**Версия:** 1.3 · 2026-06-30  
**Статус:** РЕАЛИЗОВАНО, sandbox-проверка пройдена

> **Ревью v1.2 (2026-06-25).** Спека сверена с реальной схемой БД и кодом
> (`sql/schema.sql`, `lib/orders.ts`, `lib/store-settings.ts`, `lib/cdek.ts`,
> `lib/telegram-notifications.ts`). Исправлены блокеры, без которых реализация
> упала бы на constraint'ах или создала бы двойное списание:
>
> 1. **Номера миграций сдвинуты 014→015, 015→016** — `014_rename_png_catalog_images_to_jpg.sql`
>    уже существует.
> 2. **`order_admin_events_shape_check` тоже надо ослабить** — мало добавить тип
>    в `order_admin_events_type_check`: `shape_check` — это AND/OR только по двум
>    старым типам и отклонит любую строку `cdek_status_update`.
> 3. **`delivery_recipient_cost` = 0, не `delivery_kopecks/100`** — заказ предоплачен
>    через Робокассу; это поле — сумма, которую СДЭК берёт С ПОЛУЧАТЕЛЯ за доставку.
>    Прежнее значение заставило бы клиента платить за доставку повторно в ПВЗ.
> 4. **Идемпотентность по «номер уже существует»** — при потере ответа CDEK после
>    успешного создания нужен recovery через GET по `im_number`, иначе retry помечает
>    `failed` уже созданное отправление.
> 5. **Гварды вебхука против constraint'ов `orders`** — обновлять `fulfillment_status`
>    только при `status='paid'`; всегда проставлять `tracking_number` при входе в
>    `handed_to_carrier`/`delivered` (иначе `orders_tracking_number_check`).
> 6. **OAuth-токен переиспользуем из `lib/cdek.ts`**, не дублируем кэш.
> 7. **Бюджеты попыток create vs poll разделены; reclaim зависших `processing`.**
> 8. **Автосоздание — мастер-тумблер в админке** (`cdek_auto_shipment_enabled`,
>    по умолчанию OFF, fail-closed). Тёмный запуск: код едет на прод выключенным,
>    владелец включает после теста на sandbox. Выключение останавливает только
>    новые постановки задач.
>
> **Проверка v1.3 (2026-06-30).** Sandbox СДЭК на временном стенде `rezerv`
> подтвердил создание отправления после оплаты и получение печатных форм.
> Старый вызов `/print/orders` с `type='waybill'/'barcode'` неверен: sandbox
> возвращал `v2_invalid_format`. Рабочая схема: накладная через `/print/orders`
> с `type='tpl_russia'`, штрихкод через `/print/barcodes` с `format='A4'`.

---

## Цель

После подтверждения оплаты заказ автоматически регистрируется в СДЭК через API v2.
Владелец получает накладную (PDF) прямо в админке, не заходя в ЛК СДЭК.
Статус СДЭК автоматически обновляет fulfillment_status заказа через вебхук.

Автосоздание управляется тумблером в админке (`cdek_auto_shipment_enabled`, по
умолчанию ВЫКЛ). Пока выключено — флоу оплаты не меняется, накладные создаются
вручную в ЛК СДЭК (historical fallback: `cdek-manual-launch.md`). Включается
после теста на sandbox.

---

## Что нужно добавить (пробелы в данных)

### 1. Вес и габариты товара — нет в таблице `products`

Каждая свеча весит по-разному и поставляется в своей коробке разных размеров.
СДЭК требует вес (граммы) и габариты (см) — без них API вернёт ошибку.

**Решение:** добавить на каждый товар `weight_grams`, `box_length_cm`, `box_width_cm`,
`box_height_cm`. Дефолт из `store_settings` (500 г, 11×11×11 см) — для товаров,
где поля не заполнены.

### 2. Точка сдачи (shipment_point) — нет в настройках

Тариф 136 «склад-склад»: отправитель сдаёт посылку в ПВЗ/офис СДЭК, получатель
забирает в выбранном ПВЗ. Нужен код своего офиса сдачи.

**Решение:** поле `cdek_shipment_point TEXT` в `store_settings`.
Значение: **`SPB116`** (Санкт-Петербург, пр-т Московский, д. 161).

### 3. Данные отправителя для накладной

**Решение:** `cdek_sender_name` и `cdek_sender_phone` в `store_settings`.
Имя: **МАВИТА**. Телефон — указывается при настройке.

### 4. Размеры коробки для заказа из нескольких позиций

Одна свеча → её коробка. Несколько свечей → одна общая коробка побольше.
Размер общей коробки зависит от состава заказа — нужна модель расчёта (см. ниже).

---

## Блок-схема

```
Robokassa callback
      │
      ▼
markOrderPaid()
  ├── UPDATE orders SET status='paid'
  └── INSERT cdek_task_outbox (task_type='create_shipment')  ← атомарно в одной транзакции
      │
      ▼
drainCdekOutbox() — systemd-таймер каждые 30 с (как у Telegram)
      │
      ├── cdek.createShipment() → CDEK POST /v2/orders
      │       ├── success: orders.cdek_order_uuid = UUID, fulfillment_status = 'new'
      │       │            cdek_task_outbox status='done'
      │       │            INSERT cdek_task_outbox (task_type='poll_waybill')
      │       └── error:   orders.cdek_error = message, retry (макс 5 раз, backoff)
      │
      ├── cdek.pollWaybill() — ждёт state=SUCCESSFUL, запрашивает PDF
      │       ├── done: orders.cdek_waybill_url = PDF URL
      │       └── pending: available_at += 10 с (переполить позже)
      │
      └── ← loop ─
            
CDEK Webhook → POST /api/cdek/webhook
      │
      ▼
   Маппинг CDEK-статус → fulfillment_status (см. таблицу ниже)
   UPDATE orders SET fulfillment_status, tracking_number (если handed_to_carrier)
   INSERT order_admin_events (event_type='cdek_status_update')
```

---

## Изменения в БД

### Миграция 015 — вес и габариты товара

> Номера 013 (`013_drop_ozon`) и 014 (`014_rename_png_catalog_images_to_jpg`) уже
> заняты. Эта спека добавляет **015** и **016**.

```sql
ALTER TABLE products
  ADD COLUMN weight_grams   INTEGER
    CONSTRAINT products_weight_positive   CHECK (weight_grams IS NULL OR weight_grams > 0),
  ADD COLUMN box_length_cm  SMALLINT
    CONSTRAINT products_box_length_positive CHECK (box_length_cm IS NULL OR box_length_cm > 0),
  ADD COLUMN box_width_cm   SMALLINT
    CONSTRAINT products_box_width_positive  CHECK (box_width_cm IS NULL OR box_width_cm > 0),
  ADD COLUMN box_height_cm  SMALLINT
    CONSTRAINT products_box_height_positive CHECK (box_height_cm IS NULL OR box_height_cm > 0);
```

Все четыре поля nullable. Если любое не заполнено — используются дефолты из
`store_settings` для этого товара целиком (частично заполненные габариты не
применяются).

### Миграция 016 — shipping-поля в orders и store_settings + outbox

```sql
-- Поля СДЭК в заказах
ALTER TABLE orders
  ADD COLUMN cdek_order_uuid   TEXT,         -- UUID из ответа POST /v2/orders
  ADD COLUMN cdek_number       TEXT,         -- номер СДЭК на накладной (появляется после SUCCESSFUL)
  ADD COLUMN cdek_waybill_url  TEXT,         -- URL PDF-накладной
  ADD COLUMN cdek_error        TEXT;         -- последняя ошибка создания (для retry в админке)

-- Настройки отправки в store_settings
ALTER TABLE store_settings
  ADD COLUMN cdek_auto_shipment_enabled BOOLEAN NOT NULL DEFAULT false,  -- мастер-тумблер автосоздания
  ADD COLUMN cdek_shipment_point    TEXT,          -- код ПВЗ/офиса СДЭК где сдаём посылки
  ADD COLUMN cdek_sender_name       TEXT,          -- ФИО отправителя в накладной
  ADD COLUMN cdek_sender_phone      TEXT,          -- телефон отправителя
  -- Дефолты для товаров без заполненных полей (одна свеча)
  ADD COLUMN cdek_default_weight_grams INTEGER DEFAULT 500
    CONSTRAINT store_settings_cdek_weight_positive CHECK (cdek_default_weight_grams IS NULL OR cdek_default_weight_grams > 0),
  ADD COLUMN cdek_default_length_cm SMALLINT DEFAULT 11
    CONSTRAINT store_settings_cdek_length_positive CHECK (cdek_default_length_cm IS NULL OR cdek_default_length_cm > 0),
  ADD COLUMN cdek_default_width_cm  SMALLINT DEFAULT 11
    CONSTRAINT store_settings_cdek_width_positive  CHECK (cdek_default_width_cm IS NULL OR cdek_default_width_cm > 0),
  ADD COLUMN cdek_default_height_cm SMALLINT DEFAULT 11
    CONSTRAINT store_settings_cdek_height_positive CHECK (cdek_default_height_cm IS NULL OR cdek_default_height_cm > 0),
  -- Коробка для заказа из нескольких свечей (задаётся вручную)
  ADD COLUMN cdek_multi_length_cm SMALLINT DEFAULT 30
    CONSTRAINT store_settings_cdek_multi_length_positive CHECK (cdek_multi_length_cm IS NULL OR cdek_multi_length_cm > 0),
  ADD COLUMN cdek_multi_width_cm  SMALLINT DEFAULT 20
    CONSTRAINT store_settings_cdek_multi_width_positive  CHECK (cdek_multi_width_cm IS NULL OR cdek_multi_width_cm > 0),
  ADD COLUMN cdek_multi_height_cm SMALLINT DEFAULT 15
    CONSTRAINT store_settings_cdek_multi_height_positive CHECK (cdek_multi_height_cm IS NULL OR cdek_multi_height_cm > 0),
  ADD COLUMN cdek_webhook_uuid      TEXT;          -- UUID подписки на вебхук (для управления)

-- Fail-closed: включить автосоздание можно только когда заданы точка сдачи и
-- отправитель — иначе каждый POST в СДЭК упал бы по shipment_point/sender.
-- Аналог store_settings_cdek_complete_check для ключей перевозчика.
ALTER TABLE store_settings
  ADD CONSTRAINT store_settings_cdek_auto_shipment_complete_check
    CHECK (cdek_auto_shipment_enabled = false OR (
      cdek_shipment_point IS NOT NULL AND char_length(btrim(cdek_shipment_point)) > 0 AND
      cdek_sender_name    IS NOT NULL AND char_length(btrim(cdek_sender_name))    > 0 AND
      cdek_sender_phone   IS NOT NULL AND char_length(btrim(cdek_sender_phone))   > 0));

-- Outbox для СДЭК-задач (создание + накладная)
CREATE TABLE cdek_task_outbox (
    id           BIGSERIAL PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    task_type    TEXT NOT NULL
      CONSTRAINT cdek_task_outbox_task_type_check
        CHECK (task_type IN ('create_shipment', 'poll_waybill')),
    event_key    TEXT NOT NULL UNIQUE,         -- 'create_shipment:{order_id}', 'poll_waybill:{order_id}'
    payload      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count INTEGER NOT NULL DEFAULT 0
      CONSTRAINT cdek_task_outbox_attempts_nonneg CHECK (attempt_count >= 0),
    status       TEXT NOT NULL DEFAULT 'pending'
      CONSTRAINT cdek_task_outbox_status_check
        CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    locked_at    TIMESTAMPTZ,
    done_at      TIMESTAMPTZ,
    last_error   TEXT,
    CONSTRAINT cdek_task_outbox_state_check
      CHECK ((status = 'done' AND done_at IS NOT NULL) OR
             (status IN ('pending', 'processing', 'failed') AND done_at IS NULL))
);
CREATE INDEX idx_cdek_task_outbox_ready ON cdek_task_outbox (available_at, id)
  WHERE status = 'pending';
```

Расширить `order_admin_events` — **два** constraint'а, не один. Только добавить тип
в `type_check` недостаточно: `order_admin_events_shape_check` — это `AND/OR` строго
по двум старым типам, и любая строка `cdek_status_update` будет отклонена, пока
shape не получит свою ветку.

```sql
-- 1) тип события
ALTER TABLE order_admin_events DROP CONSTRAINT order_admin_events_type_check;
ALTER TABLE order_admin_events
  ADD CONSTRAINT order_admin_events_type_check
    CHECK (event_type IN ('cancelled', 'fulfillment_transition', 'cdek_status_update'));

-- 2) ФОРМА события (обязательно!): cdek_status_update пишет from/to статус,
--    reason всегда NULL, tracking_number — опционально (есть при handed/delivered).
ALTER TABLE order_admin_events DROP CONSTRAINT order_admin_events_shape_check;
ALTER TABLE order_admin_events
  ADD CONSTRAINT order_admin_events_shape_check CHECK (
    (event_type = 'cancelled' AND reason IS NOT NULL
       AND char_length(btrim(reason)) BETWEEN 5 AND 500
       AND from_fulfillment_status = 'awaiting_payment'
       AND to_fulfillment_status = 'cancelled' AND tracking_number IS NULL)
    OR (event_type = 'fulfillment_transition' AND reason IS NULL
       AND from_fulfillment_status IS NOT NULL AND to_fulfillment_status IS NOT NULL
       AND ((from_fulfillment_status = 'new' AND to_fulfillment_status = 'packing' AND tracking_number IS NULL)
         OR (from_fulfillment_status = 'packing' AND to_fulfillment_status = 'handed_to_carrier'
             AND tracking_number IS NOT NULL AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64)
         OR (from_fulfillment_status = 'handed_to_carrier' AND to_fulfillment_status = 'delivered' AND tracking_number IS NULL)))
    -- НОВОЕ: вебхук СДЭК. Переход может быть «через ступеньку» (CDEK шлёт сразу
    -- handed_to_carrier из new), поэтому пары статусов не фиксируем; reason=NULL.
    OR (event_type = 'cdek_status_update' AND reason IS NULL
       AND from_fulfillment_status IS NOT NULL AND to_fulfillment_status IS NOT NULL)
  );
```

`orders_fulfillment_status_check` — менять **не нужно**: `'new'` уже входит
(schema.sql:86), и `markOrderPaid()` уже ставит `fulfillment_status='new'` при оплате
(`lib/orders.ts:322`). Подтверждено ревью.

**Актор вебхука.** `order_admin_events.actor_login_at` — `BIGINT NOT NULL`. У вебхука
нет залогиненного админа → использовать константу-сентинел `ACTOR_CDEK_WEBHOOK = 0`
(0 не пересекается с реальным `login_at` в мс). В админ-карточке заказа строки
событий с `actorLoginAt === 0` рендерить как «СДЭК (автоматически)», а не как админа.

---

## СДЭК API — детали вызова

### Тариф: 136 «Посылка склад-склад»

```
Мы сдаём в ПВЗ/офис СДЭК (shipment_point) → клиент забирает в своём ПВЗ (delivery_point)
```

### Тело запроса POST /v2/orders

```json
{
  "type": 1,
  "tariff_code": 136,
  "number": "MAVITA-{order.id}",
  "comment": "Заказ #{order.id}",
  "shipment_point": "{store_settings.cdek_shipment_point}",
  "delivery_point": "{order.pickup_point_code}",
  "sender": {
    "name":   "{store_settings.cdek_sender_name}",
    "phones": [{ "number": "{store_settings.cdek_sender_phone}" }]
  },
  "recipient": {
    "name":   "{order.customer_name}",
    "phones": [{ "number": "{order.customer_phone}" }]
  },
  "delivery_recipient_cost": { "value": 0 },
  "packages": [{
    "number": "1",
    "weight": {calculated_weight_grams},
    "length": {store_settings.cdek_default_length_cm},
    "width":  {store_settings.cdek_default_width_cm},
    "height": {store_settings.cdek_default_height_cm},
    "items": [
      {
        "name":     "{item.product_name}",
        "ware_key": "{item.product_id}",
        "payment":  { "value": 0 },
        "cost":     {item.price_kopecks / 100},
        "weight":   {item.weight_grams_per_unit},
        "amount":   {item.quantity}
      }
    ]
  }]
}
```

**Расчёт веса и габаритов пакета:**

```
total_units = SUM(item.quantity)                  -- итого штук в заказе

-- Вес: суммируем с подстановкой дефолта за каждую единицу без веса
package_weight_grams = SUM(
  COALESCE(product.weight_grams, settings.cdek_default_weight_grams) * item.quantity
)

-- Габариты зависят от количества позиций в заказе
IF total_units == 1:
  -- одна свеча → её собственная коробка (или дефолт одиночной)
  length = COALESCE(product.box_length_cm, settings.cdek_default_length_cm)
  width  = COALESCE(product.box_width_cm,  settings.cdek_default_width_cm)
  height = COALESCE(product.box_height_cm, settings.cdek_default_height_cm)
ELSE:
  -- несколько свечей → общая коробка из настроек
  length = settings.cdek_multi_length_cm
  width  = settings.cdek_multi_width_cm
  height = settings.cdek_multi_height_cm
```

> **Примечание по multi-box:** значения `cdek_multi_*` задаёт владелец в настройках,
> исходя из реальных коробок, которые он использует. Предлагаемый дефолт: 30×20×15 см.
> При большом заказе (много свечей) владелец сам видит итог и при необходимости
> может скорректировать размеры в настройках.

**Declared value (cost в items):** включаем фактическую цену товара (СДЭК берёт
страховой сбор с объявленной стоимости — это ожидаемо).
`payment.value = 0` — наложенного платежа нет (уже оплачено через Робокассу).

**`delivery_recipient_cost.value = 0` (КРИТИЧНО).** Это сумма, которую СДЭК берёт
**с получателя** за доставку в момент выдачи. Заказ предоплачен (товар + доставка)
через Робокассу, поэтому в ПВЗ клиент не доплачивает ничего. Любое ненулевое
значение здесь = повторное списание доставки с покупателя.

**`number` уникален по аккаунту.** `MAVITA-{order.id}` уникален навсегда (id —
SERIAL, не переиспользуется). Это и ключ recovery-идемпотентности (см. ниже).

**`ware_key = product_id` уникален в пакете**, потому что `buildOrderLines`
схлопывает дубли одного slug в одну позицию (`lib/orders.ts`). Полагаемся на это.

**Авторизацию НЕ дублируем.** OAuth-токен и маппинг ошибок уже реализованы в
`lib/cdek.ts` (`accessToken`, кэш по fingerprint credentials). Вынести оттуда
переиспользуемый authed-fetch (экспортировать `accessToken` или хелпер
`cdekAuthedRequest(creds, method, path, body)`), а `lib/cdek-shipment.ts` —
строить на нём, а не заводить второй кэш токена.

### Ответ и идемпотентность

Ответ: `{ entity: { uuid: "..." }, requests: [{ state: "ACCEPTED" }] }`

Идемпотентность — два уровня:

1. **Локальный:** перед созданием проверить `orders.cdek_order_uuid IS NULL`.
   Если UUID уже есть — не создавать повторно, сразу перейти к poll_waybill.
   При повторном колбэке Робокассы `markOrderPaid()` вернёт `'already_paid'` →
   задача в outbox не добавляется повторно (UNIQUE на `event_key`).

2. **Recovery при потерянном ответе (КРИТИЧНО).** Если POST дошёл до СДЭК и
   отправление создано, но ответ потерян (timeout/сеть после коммита на стороне
   СДЭК), у нас `cdek_order_uuid IS NULL`, а повторный POST с тем же `number`
   вернёт ошибку валидации «заказ с номером уже существует». **Не помечать `failed`
   слепо.** Перед тем как трактовать 400 как фатальную ошибку, выполнить
   `GET /v2/orders?im_number=MAVITA-{order.id}`; если СДЭК вернул сущность —
   подобрать её `uuid`, записать в `orders.cdek_order_uuid`, задачу `create_shipment`
   закрыть `done` и поставить `poll_waybill`. Только если по `im_number` ничего нет —
   это настоящая ошибка валидации → `failed` + Telegram-alert.

---

## Накладная и штрихкод (waybill/barcode PDF)

Накладная и штрихкод генерируются асинхронно на стороне СДЭК. После создания
отправления нужно сначала дождаться успешного состояния заявки, затем создать
две отдельные print-задачи.

```
1. После получения uuid от POST /v2/orders — вставить задачу poll_waybill в outbox.
2. drainCdekOutbox() для poll_waybill:
   a. GET /v2/orders/{uuid} → проверить requests[0].state == "SUCCESSFUL"
      Если ACCEPTED — available_at += 10 с, retry.
   b. Накладная:
      POST /v2/print/orders
      { "orders": [{ "order_uuid": uuid }], "copy_count": 2, "type": "tpl_russia" }
      Получить print_task_uuid.
   c. Штрихкод:
      POST /v2/print/barcodes
      { "orders": [{ "order_uuid": uuid }], "copy_count": 1, "format": "A4", "lang": "RUS" }
      Получить print_task_uuid.
   d. GET /v2/print/orders/{print_task_uuid} и
      GET /v2/print/barcodes/{print_task_uuid} — ждать entity.statuses[].code == "READY".
      Если READY нет — available_at += 5 с, retry.
   e. Сохранить entity.url:
      orders.cdek_waybill_url и orders.cdek_barcode_url.
```

URL накладной и штрихкода — прямые ссылки на PDF на серверах СДЭК. В админке
отображать кнопками «Скачать накладную» и «Скачать штрихкод».

> Sandbox-факт 2026-06-29/30: `/v2/print/orders` с `type='waybill'` или
> `type='barcode'` не принимается (`v2_invalid_format`). После перехода на
> `/print/orders` + `tpl_russia` и `/print/barcodes` + `A4/RUS` `poll_waybill`
> сохранил оба URL в заказе.

---

## Воркер `drainCdekOutbox()` — механика

Калька `drainNotificationOutbox` (`lib/telegram-notifications.ts`), но со своими
статусами (`pending → processing → done | failed`):

- **Claim:** `... WHERE status='pending' AND available_at <= now() ORDER BY available_at, id
  LIMIT 1 FOR UPDATE SKIP LOCKED`, затем `UPDATE ... SET status='processing', locked_at=now()`.
- **Reclaim зависших (обязательно):** в начале цикла `UPDATE cdek_task_outbox
  SET status='pending', locked_at=NULL WHERE status='processing' AND locked_at < now() - interval '15 minutes'`
  — иначе краш воркера между claim и завершением навсегда «подвесит» задачу
  (у notification-outbox это есть, спека v1.1 это упустила).
- **Бюджеты попыток РАЗДЕЛЕНЫ по task_type** (один `attempt_count`, разная политика):
  - `create_shipment`: фатальные ошибки и сеть инкрементят `attempt_count`;
    backoff 30 с → 2 мин → 10 мин → 1 ч, после 5-й → `failed`.
  - `poll_waybill`: ожидание `state=SUCCESSFUL` и print-статуса `READY`
    (CDEK генерит накладную и штрихкод асинхронно) —
    это **не ошибка**, переносить `available_at += 10 с` БЕЗ инкремента
    `attempt_count`, с отдельным потолком по времени (`created_at` старше 3 ч →
    `failed`, заказ при этом рабочий, просто без PDF). Иначе нормальное ожидание
    PDF за минуту съело бы 5-попыточный бюджет.

---

## Вебхук СДЭК

### Регистрация (одноразово при настройке)

Новая кнопка в admin → настройки доставки: «Зарегистрировать вебхук».

```
POST /v2/webhooks
{ "url": "https://mavita.ru/api/cdek/webhook", "type": "ORDER_STATUS" }
```

Сохранить полученный UUID в `store_settings.cdek_webhook_uuid`.

Кнопка меняет лейбл на «Вебхук зарегистрирован ✓» с возможностью
удалить (`DELETE /v2/webhooks/{uuid}`) и перерегистрировать.

### Эндпоинт POST /api/cdek/webhook

Публичный route (вне iron-session), как `robokassa/result`. Верификация: СДЭК не
подписывает вебхуки HMAC → проверяем, что присланный uuid отправления есть в нашей
БД (`orders.cdek_order_uuid`). Чужой/неизвестный uuid → `200 OK` и игнор (не 4xx,
иначе СДЭК будет ретраить).

**Форма payload — сверить с sandbox перед кодом.** Для `type='ORDER_STATUS'` СДЭК
шлёт примерно: `{ "type":"ORDER_STATUS", "uuid":"<uuid отправления>", "attributes":{
"code":"<STATUS_CODE>", "cdek_number":"<номер накладной>", "is_return":false, ... } }`.
Точные имена полей (`uuid` vs `attributes.entity_uuid`, где лежит `cdek_number`)
**обязательно подтвердить по реальному вебхуку sandbox** — мэппинг ниже опирается
на `attributes.code` и `attributes.cdek_number`, но это единственное место спеки,
которое нельзя проверить по нашему коду.

**Гварды против constraint'ов `orders` (КРИТИЧНО):**

- Обновлять `fulfillment_status` **только если `orders.status='paid'`**. Если заказ
  отменён/не оплачен (`status IN ('cancelled','pending')`) — записать факт в лог/Telegram,
  но `fulfillment_status` не трогать: `orders_payment_fulfillment_check` запрещает
  `paid`-статусы при `cancelled`, и UPDATE упадёт.
- Вход в `handed_to_carrier` ИЛИ `delivered` требует `tracking_number` (5–64 симв.,
  `orders_tracking_number_check`). Поэтому **в том же UPDATE** всегда проставлять
  `tracking_number = COALESCE(NULLIF(btrim(attributes.cdek_number),''), orders.tracking_number, left(cdek_order_uuid, 8))`.
  Это закрывает и прыжок CDEK сразу `new → delivered` (трек до этого не ставился).
- `left(cdek_order_uuid, 8)` = 8 символов ≥ 5 — нижнюю границу проходит.

### Маппинг СДЭК-статусов → fulfillment_status

| CDEK status_code | fulfillment_status | tracking_number |
|---|---|---|
| CREATED, ACCEPTED | new | — |
| RECEIVED_AT_SHIPMENT_ADDRESS | new | — |
| READY_FOR_SHIPMENT_IN_SENDER_CITY | packing | — |
| TAKEN_FROM_SENDER | packing | — |
| TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY | handed_to_carrier | = cdek_number |
| IN_TRANSIT, RETURNED_TO_TRANSIT_CITY | handed_to_carrier | сохранить |
| READY_FOR_PICKUP | handed_to_carrier | сохранить |
| DELIVERED | delivered | сохранить |
| NOT_DELIVERED | — (нет перехода) | Telegram-alert владельцу |

**Переходы только вперёд.** Нужен явный порядок для сравнения:
`awaiting_payment(0) < new(1) < packing(2) < handed_to_carrier(3) < delivered(4)`
(`cancelled` — вне шкалы). Если `rank(target) <= rank(current)` — игнорировать
(СДЭК может прислать старый статус с опозданием или повтор). UPDATE делать только
при строгом продвижении вперёд — это же даёт идемпотентность повторного вебхука.

Каждый реальный переход → INSERT `order_admin_events(event_type='cdek_status_update',
from_fulfillment_status, to_fulfillment_status, actor_login_at=ACTOR_CDEK_WEBHOOK)`
+ `enqueueOrderNotification(eventType='fulfillment_changed')` с детерминированным
`event_key = 'order:{id}:fulfillment:cdek:{target_status}'` (дедуп повторных вебхуков
одного статуса; существующий форматтер уже добавляет трек для `handed_to_carrier`).

Актор: `ACTOR_CDEK_WEBHOOK = 0` (см. раздел про `order_admin_events`).
`tracking_number` проставляется по правилу из гвардов выше.

---

## Retry и обработка ошибок

| Ситуация | Поведение |
|---|---|
| СДЭК недоступен (5xx, timeout) | retry с exponential backoff: 30 с → 2 мин → 10 мин → 1 ч → failed |
| СДЭК вернул ошибку валидации (400) | сохранить в cdek_error, статус failed, Telegram-alert |
| Создание успешно, но poll_waybill завис | накладная генерится долго, retry до 3 ч; без накладной заказ рабочий |
| Вебхук не пришёл | fulfillment_status обновляется только вручную из ЛК СДЭК до этого |
| Заказ отменён в СДЭК | Telegram-alert, вручную |

**Максимум попыток create_shipment: 5.** После — статус `'failed'`, `cdek_error`
заполнен. В admin-детали заказа — кнопка «Повторить создание в СДЭК» (сбрасывает
статус на pending, attempt_count на 0).

---

## Изменения в коде

### Новые файлы

| Файл | Содержание |
|---|---|
| `lib/cdek-shipment.ts` | `createShipment(orderId, creds, settings)`, `pollWaybill(orderId, creds)` |
| `lib/cdek-outbox.ts` | `drainCdekOutbox()` — воркер outbox (аналог `drainNotificationOutbox`) |
| `scripts/drainCdekOutbox.ts` | точка входа для systemd-таймера |
| `app/api/cdek/webhook/route.ts` | POST — приём вебхука СДЭК |

### Изменения в существующих файлах

| Файл | Изменение |
|---|---|
| `lib/orders.ts` → `markOrderPaid()` | добавить INSERT в `cdek_task_outbox` (см. ниже) |
| `lib/store-settings.ts` | новые поля в `SettingsRow`/`ALL_COLS`, геттер `getCdekShipmentSettings()`, сейвер `saveCdekShipmentSettings()` (включая флаг `cdek_auto_shipment_enabled`); сейвер ловит `store_settings_cdek_auto_shipment_complete_check` и отдаёт понятную ошибку «нельзя включить без точки сдачи и отправителя» |
| `app/admin/settings/page.tsx` | **тумблер «Автосоздание накладной в СДЭК» (вкл/выкл)** + поля: shipment_point, sender_name/phone, дефолтный вес/размеры, кнопка вебхука. Тумблер задизейблен/со сноской, пока не заполнены точка сдачи и отправитель (зеркалит constraint) |
| `app/admin/products/[id]/page.tsx` | поле weight_grams в форме товара |
| `app/admin/orders/[id]/page.tsx` | секция СДЭК: uuid, cdek_number, ссылка на накладную, cdek_error + retry |
| `sql/schema.sql` | добавить новые колонки (для новых окружений) |

### Интеграция в `markOrderPaid()` — детали

Сейчас (`lib/orders.ts:318-326`) функция при успешном переходе `pending → paid`
делает `enqueueOrderNotification`. Туда же, в **той же транзакции**, добавить INSERT
задачи СДЭК, но **только для cdek-ПВЗ-заказа при включённом тумблере** — расширить
SELECT (`delivery_method`, `pickup_point_code`) и читать флаг из `store_settings` в
той же транзакции; ставить задачу лишь когда:

```text
result === 'paid'                              -- не 'already_paid'/'cancelled'/'amount_mismatch'
  AND delivery_method = 'cdek_pickup'
  AND pickup_point_code IS NOT NULL
  AND store_settings.cdek_auto_shipment_enabled = true   -- мастер-тумблер из админки
```

INSERT с `event_key='create_shipment:{order_id}'` и `ON CONFLICT (event_key) DO NOTHING`
(двойная защита идемпотентности поверх `already_paid`).

Флаг читать одним подзапросом/SELECT в той же транзакции (не отдельным вызовом —
иначе TOCTOU между чтением флага и INSERT; впрочем, `event_key` UNIQUE делает лишний
INSERT безвредным, так что строгий lock не нужен — достаточно обычного чтения
`SELECT cdek_auto_shipment_enabled FROM store_settings WHERE singleton = true`).

**Семантика тумблера.** Выключение влияет только на **будущие** оплаты — уже
поставленные в outbox задачи и уже созданные отправления продолжают жить. Кнопка
«Повторить создание в СДЭК» в карточке заказа — ручное действие оператора и
**работает независимо от тумблера** (оператор сознательно дожимает конкретный заказ).

### systemd-таймер (VPS)

Новый unit `mavita-cdek.service` + `mavita-cdek.timer` (каждые 30 с),
по аналогии с `mavita-notify.{service,timer}`.

---

## Переменные окружения

Новых переменных в продакшене нет — точка сдачи, отправитель и габариты лежат в
`store_settings`, ключи API — зашифрованы там же.

**Sandbox-тестирование требует переключения `CDEK_API_BASE`.** Прод-хост и sandbox —
разные домены (`api.cdek.ru/v2` vs `api.edu.cdek.ru/v2`), а base URL берётся из env
(`lib/cdek.ts:19`), тогда как credentials — из БД. Поэтому «новых переменных нет» —
неточно для теста: на тест-стенде надо выставить `CDEK_API_BASE=https://api.edu.cdek.ru/v2`
и загрузить общие sandbox-ключи из документации СДЭК в настройки. Тестового
личного кабинета у СДЭК нет. На проде `CDEK_API_BASE` не задаётся (дефолт).
Совместить прод-ключи с sandbox-base в одном процессе нельзя — тест только на отдельном стенде.

---

## Остаточные операционные пункты

Sandbox-проверка закрыта. Остаются хозяйственные параметры, которые можно
уточнять без изменения механики интеграции:

- Sandbox-проверка выполнена 2026-06-29/30 на временном стенде `rezerv` с общими
  тестовыми ключами из документации СДЭК. Тестового ЛК у СДЭК нет.
- Уточнить реальные размеры коробки для нескольких свечей (дефолт 30×20×15 — поправить если не совпадает)
- **Подтвердить, что `SPB116` принимает посылки на сдачу** (тариф 136 «склад-склад»:
  не всякий ПВЗ/постамат работает как пункт сдачи отправителя). Иначе POST вернёт
  ошибку по `shipment_point` — проверить на sandbox первым же тестовым заказом.

---

### Зафиксированные параметры (из ответов владельца)

| Параметр | Значение |
|---|---|
| `cdek_shipment_point` | `SPB116` (СПб, пр-т Московский, 161) |
| `cdek_sender_name` | `МАВИТА` |
| `cdek_sender_phone` | `+79211899008` |
| `cdek_default_weight_grams` | `500` |
| Одиночная коробка (дефолт) | 11 × 11 × 11 см |
| Мульти-коробка (дефолт) | 30 × 20 × 15 см *(уточнить под реальные коробки)* |
| Всегда один пакет на заказ | да |
| Тест на sandbox | выполнен 2026-06-29/30 с общими тестовыми ключами СДЭК |

---

## Scope — что НЕ входит в эту спеку

- Курьерский забор (тариф дверь-склад) — Фаза 2 роадмапа
- Автоматическое создание акта сдачи-приёмки СДЭК (пока вручную)
- Push-уведомление клиенту о трек-номере по email (отдельно)
- Отмена отправления в СДЭК при отмене заказа (пока вручную в ЛК)

---

## Оценка сложности

| Компонент | Оценка |
|---|---|
| Миграции (015, 016) | ~1 ч |
| `lib/cdek-shipment.ts` (API-вызовы + расчёт веса) | ~3 ч |
| `lib/cdek-outbox.ts` + `scripts/drainCdekOutbox.ts` | ~2 ч |
| Интеграция в `markOrderPaid()` | ~1 ч |
| Вебхук + маппинг статусов | ~2 ч |
| Admin UI (настройки + карточка заказа + поле веса) | ~3 ч |
| systemd-юниты + деплой | ~1 ч |
| **Итого** | **~13 ч** |
