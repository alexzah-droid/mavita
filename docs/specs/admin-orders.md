# Спецификация: админка — управление заказами

Дата: 2026-06-20  
Фаза: **Ф4**, компонент 2  
Статус: ✅ реализована в репозитории; production rollout требует backup и
миграцию `003`. СДЭК отключён `DELIVERY_ENABLED=false`, поэтому текущая проверка
платежей проходит без ПВЗ и CDEK OAuth-учётных данных.

Связанные документы: [architecture.md](../../architecture.md),
[PROJECT_CORE.md](../../PROJECT_CORE.md) (I2, I3, I4, I8),
[docs/tech-debt.md](../tech-debt.md) (TD-6, TD-17, TD-18),
[docs/specs/admin-products.md](admin-products.md) (авторизация и API-конвенции),
[виджет СДЭК](https://widget.cdek.ru/) (выбор ПВЗ),
[FAQ СДЭК](https://mobile.cdek.ru/faq) (данные получателя).

---

## 0. Результат критического ревью (2026-06-20)

Ревью выполнено против текущего кода (`lib/orders.ts`, `lib/auth.ts`,
`app/api/robokassa/*`, `sql/schema.sql`). Его замечания отражены ниже в
нормативных разделах: CDEK-виджет выбирает ПВЗ, сервер повторно проверяет код
через OAuth API CDEK; цифровой поиск ищет и номер заказа, и телефон;
`markOrderPaid` меняет две оси статуса в одной транзакции; checkout передаёт
ожидаемые суммы и получает `409 PRICE_CHANGED` при их изменении.

Внешний gate остаётся только для **включения** ПВЗ СДЭК: понадобятся Пауза 2 и
действующие `CDEK_CLIENT_ID`/`CDEK_CLIENT_SECRET`. Он не блокирует миграцию,
admin API, UI заказов или оплату без доставки.

---

## 1. Цель владельца

Дать владельцу магазина путь от оплаченного заказа до передачи посылки СДЭК:
покупатель выбирает ПВЗ и оплачивает товары вместе с доставкой, а владелец видит
полные данные, собирает заказ, создаёт отправление в ЛК СДЭК и фиксирует трек.
Админка снимает необходимость работать с `psql`, но не превращается в платёжный
кабинет: подтверждение оплаты остаётся исключительной обязанностью Робокассы.

---

## 2. Scope и границы

### В scope

1. Список заказов с постраничной загрузкой, фильтрами по платёжному статусу и
   дате создания, поиском по номеру и контакту покупателя.
2. Карточка заказа: контакты, неизменяемый snapshot позиций и цен, сумма,
   ПВЗ СДЭК, доставка, статусы исполнения, трек-номер и журнал ручных действий.
3. Единственное ручное действие — отменить заказ в `pending`; операция требует
   причину и фиксируется в неизменяемом журнале.
4. При оформлении: обязательные ФИО и телефон получателя, выбор ПВЗ СДЭК,
   серверный snapshot фиксированной (в том числе нулевой) стоимости доставки и
   включение её в платёж.
5. В админке: единственная настройка тарифа «Доставка СДЭК до ПВЗ», переходы
   исполнения `new → packing → handed_to_carrier → delivered` и ручная запись
   трек-номера после создания отправления в ЛК СДЭК.
6. Защита UI и API существующей admin-сессией и CSRF-guard.

### Не в scope

- ручная установка `paid`, возвраты, повторная отправка платежа и работа с ЛК
  Робокассы;
- редактирование покупателя, состава, цены, `token`, `inv_id` или
  `robokassa_data` заказа;
- курьерская доставка до двери, самовывоз, Почта России и иные перевозчики;
- автоматическое создание накладной СДЭК, печать этикетки, автоматический
  трекинг и автоматическая смена статуса по вебхукам СДЭК;
- e-mail/SMS/мессенджер-уведомления. В частности, после отмены нельзя обещать
  покупателю уведомление: TD-6 ещё не реализован;
- экспорт заказов и отчёты.

Первый релиз обслуживает только **доставку в ПВЗ СДЭК по РФ**. Самовывоза нет.
Тариф один, задаётся владельцем в админке и может быть нулевым (бесплатная
доставка для покупателя). Это не расчёт СДЭК: цена одинакова для любого
доступного ПВЗ и показывается покупателю до
перехода к оплате.

---

## 3. Домен и правила переходов

Источник истины — `orders.status`:

| Статус | Значение в UI | Кто меняет | Допустимый следующий статус |
| --- | --- | --- | --- |
| `pending` | Ожидает оплаты | создание заказа; админская отмена; Робокасса | `paid` или `cancelled` |
| `paid` | Оплачен | только проверенный ResultURL Робокассы | нет |
| `cancelled` | Отменён | только admin API из `pending` | нет |

Платёжный статус и исполнение — разные оси. `paid` означает только получение
денег, а не то, что посылка собрана или передана перевозчику.

| Статус исполнения | Значение | Кто меняет | Допустимый следующий статус |
| --- | --- | --- | --- |
| `awaiting_payment` | Ожидает оплаты | создание заказа | `new` или `cancelled` автоматически вместе с оплатой/отменой |
| `new` | Оплачен, ожидает сборки | ResultURL Робокассы | `packing` |
| `packing` | Собирается | администратор | `handed_to_carrier` |
| `handed_to_carrier` | Передан перевозчику | администратор, только с трек-номером | `delivered` |
| `delivered` | Выдан получателю | администратор после проверки в ЛК СДЭК | нет |
| `cancelled` | Отменён до оплаты | admin API | нет |

Правила:

- `paid` устанавливает только существующий `POST`/`GET /api/robokassa/result`
  после проверки подписи и сверки **полной** суммы (товары + доставка) (I3).
  В той же транзакции `fulfillment_status` меняется
  `awaiting_payment → new`. В админском API действия «оплатить» нет.
- Администратор может отменить только `pending`-заказ. Причина обязательна,
  очищается от пробелов и имеет длину 5–500 символов.
- Отмена необратима из UI. Если покупатель оплатил уже отменённый заказ,
  ResultURL вернёт ошибку `Order cancelled` и сохранит статус `cancelled`
  (защита TD-17); владелец разбирает платёж вручную в Робокассе. Это явное
  предупреждение в модальном окне отмены.
- Попытка отменить `paid` или уже `cancelled` заказ возвращает `409` и ничего не
  записывает. Гонка с платёжным callback разрешается атомарным `UPDATE ... WHERE
  status = 'pending'`: побеждает первое успешное изменение, второе получает
  актуальный статус.
- Исторические `order_items.product_name`, `price_kopecks`, `quantity` и
  `orders.items_kopecks`, `delivery_kopecks`, `total_kopecks` — snapshot на
  момент создания (I2, I9); они никогда не пересчитываются из текущего каталога
  или изменившейся настройки тарифа.
- Отмена `pending` в той же транзакции переводит
  `fulfillment_status` из `awaiting_payment` в `cancelled`. После оплаты отмены
  и возвраты — отдельный финансовый процесс вне этой фазы.
- Переходы исполнения записываются в audit и не меняют платёжный статус. Для
  `handed_to_carrier` обязателен трек-номер, полученный владельцем после ручного
  создания накладной в ЛК СДЭК. Название статуса нейтрально для следующих
  перевозчиков.

Это реализация I4: смена статуса происходит только через выделенный API и
серверный data-слой, не через ручной SQL. Для ручной смены обязательно создаётся
аудит-запись в той же транзакции.

---

## 4. Данные и миграция `003`

Миграция называется `003_orders_delivery_and_admin_events.sql`. Она аддитивна:
существующие заказы не теряются и получают корректный legacy-snapshot
`items_kopecks=total_kopecks`, `delivery_kopecks=0`. Новые заказы обязаны иметь
данные ПВЗ; legacy-заказы в интерфейсе помечаются «данные доставки отсутствуют».

### 4.1. Настройка тарифа

Одна строка `store_settings` хранит единственный актуальный тариф СДЭК до ПВЗ.
`0` означает бесплатную доставку для покупателя; её фактическую стоимость
магазин покрывает сам. Настройка существует всегда до включения checkout.

```sql
CREATE TABLE IF NOT EXISTS store_settings (
    singleton                       BOOLEAN PRIMARY KEY DEFAULT true
                                    CONSTRAINT store_settings_singleton_check CHECK (singleton),
    cdek_pickup_delivery_kopecks    INTEGER NOT NULL
                                    CONSTRAINT store_settings_cdek_delivery_nonnegative CHECK (cdek_pickup_delivery_kopecks >= 0),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_actor_login_at       BIGINT NOT NULL
);
```

До первой настройки строки в таблице нет: checkout отвечает `503` с нейтральным
сообщением «Оформление временно недоступно». Нулевой тариф создаётся только
явным `PATCH` как решение о бесплатной доставке, а не как fallback. `PATCH`
настройки делает upsert и записывает время/сессию последнего
изменения. Для нового заказа тариф читается `FOR SHARE` в той же транзакции, что
и товарный каталог, и сохраняется в самом заказе.

### 4.2. Snapshot доставки в заказе

В `orders` добавляются:

```sql
items_kopecks              INTEGER NOT NULL CHECK (items_kopecks >= 0),
delivery_kopecks           INTEGER NOT NULL CHECK (delivery_kopecks >= 0),
delivery_method            TEXT,
delivery_carrier           TEXT,
pickup_point_code          TEXT,
pickup_point_city          TEXT,
pickup_point_name          TEXT,
pickup_point_address       TEXT,
fulfillment_status         TEXT NOT NULL,
tracking_number            TEXT
```

Обязательные named-ограничения:

```sql
CONSTRAINT orders_total_components_check
  CHECK (total_kopecks = items_kopecks + delivery_kopecks),
CONSTRAINT orders_delivery_method_check
  CHECK (
    (delivery_method IS NULL AND delivery_carrier IS NULL AND delivery_kopecks = 0)
    OR (delivery_method = 'cdek_pickup' AND delivery_carrier = 'cdek')
  ),
CONSTRAINT orders_pickup_point_snapshot_check
  CHECK (
    delivery_method IS NULL OR (
      delivery_method = 'cdek_pickup'
      AND delivery_kopecks >= 0
      AND pickup_point_code IS NOT NULL AND char_length(btrim(pickup_point_code)) > 0
      AND pickup_point_city IS NOT NULL AND char_length(btrim(pickup_point_city)) > 0
      AND pickup_point_name IS NOT NULL AND char_length(btrim(pickup_point_name)) > 0
      AND pickup_point_address IS NOT NULL AND char_length(btrim(pickup_point_address)) > 0
    )
  ),
CONSTRAINT orders_fulfillment_status_check
  CHECK (fulfillment_status IN ('awaiting_payment', 'new', 'packing', 'handed_to_carrier', 'delivered', 'cancelled')),
CONSTRAINT orders_payment_fulfillment_check
  CHECK (
    (status = 'pending' AND fulfillment_status = 'awaiting_payment')
    OR (status = 'paid' AND fulfillment_status IN ('new', 'packing', 'handed_to_carrier', 'delivered'))
    OR (status = 'cancelled' AND fulfillment_status = 'cancelled')
  ),
CONSTRAINT orders_tracking_number_check
  CHECK (
    (fulfillment_status IN ('handed_to_carrier', 'delivered')
     AND tracking_number IS NOT NULL
     AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64)
    OR
    (fulfillment_status NOT IN ('handed_to_carrier', 'delivered')
     AND tracking_number IS NULL)
  )
```

`customer_name` становится ФИО **получателя**, а `customer_phone` — телефоном
получателя; для новых заказов оба проверяются приложением как обязательные.
Существующие колонки не переводятся в `NOT NULL`, чтобы не ломать старые данные.
Email остаётся обязательным контактом покупателя.

`delivery_method IS NULL` допускается только ради legacy-строк: SQL-ограничение
не может отличить старую строку от ручного будущего INSERT без отдельной версии
схемы. Поэтому единственный публичный путь создания (`createOrder`) требует
delivery snapshot, а интеграционный тест явно проверяет, что новый заказ без
него не создаётся. Админ API не имеет маршрута создания заказа.

ПВЗ хранится в нейтральных полях: `delivery_carrier='cdek'` и
`delivery_method='cdek_pickup'` в первом релизе; следующий перевозчик добавит
свой carrier и method без переименования snapshot-колонок. Код, город, название
и адрес — неизменяемый читаемый snapshot. Код нужен для создания отправления, а
текст остаётся понятен, если перевозчик переименует точку или временно сделает
её недоступной. Свободного поля «ПВЗ СДЭК» нет.

В самой миграции поля `items_kopecks`, `delivery_kopecks` и
`fulfillment_status` сначала добавляются nullable. Затем legacy-строки получают
`items_kopecks=total_kopecks`, `delivery_kopecks=0`, а статус исполнения —
`awaiting_payment`/`new`/`cancelled` по текущему платёжному статусу. Только после
backfill для этих полей ставится `NOT NULL` и добавляются CHECK. Для legacy
заказов поля delivery остаются `NULL`, а `delivery_kopecks=0`; это единственное
разрешённое исключение из доставки. Так migration
работает на уже заполненной production-БД.

### 4.3. Журнал действий и индексы

```sql
CREATE TABLE IF NOT EXISTS order_admin_events (
    id                         BIGSERIAL PRIMARY KEY,
    order_id                   INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    event_type                 TEXT NOT NULL CONSTRAINT order_admin_events_type_check
                               CHECK (event_type IN ('cancelled', 'fulfillment_transition')),
    reason                     TEXT,
    from_fulfillment_status    TEXT,
    to_fulfillment_status      TEXT,
    tracking_number            TEXT,
    actor_login_at             BIGINT NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_admin_events_shape_check CHECK (
      (event_type = 'cancelled'
       AND reason IS NOT NULL AND char_length(btrim(reason)) BETWEEN 5 AND 500
       AND from_fulfillment_status = 'awaiting_payment'
       AND to_fulfillment_status = 'cancelled'
       AND tracking_number IS NULL)
      OR
      (event_type = 'fulfillment_transition'
       AND reason IS NULL
       AND from_fulfillment_status IS NOT NULL
       AND to_fulfillment_status IS NOT NULL
       AND (
         (from_fulfillment_status = 'new' AND to_fulfillment_status = 'packing' AND tracking_number IS NULL)
         OR (from_fulfillment_status = 'packing' AND to_fulfillment_status = 'handed_to_carrier'
             AND tracking_number IS NOT NULL AND char_length(btrim(tracking_number)) BETWEEN 5 AND 64)
         OR (from_fulfillment_status = 'handed_to_carrier' AND to_fulfillment_status = 'delivered'
             AND tracking_number IS NULL)
       ))
    )
);

CREATE INDEX IF NOT EXISTS idx_orders_created_id_desc
    ON orders (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_admin_events_order_created
    ON order_admin_events (order_id, created_at DESC, id DESC);
```

Та же схема добавляется в `shop/sql/schema.sql`; миграция использует `ADD COLUMN
IF NOT EXISTS`, backfill и защищённый `DO $$` для named-constraints. Она должна
быть идемпотентной и иметь структурный тест, аналогичный
`002_admin_visibility_discount.test.ts`.

`actor_login_at` и `updated_by_actor_login_at` — значение `AdminSession.loginAt`;
в проекте один администратор,
поэтому этого достаточно, чтобы связать действие с конкретной сессией без новой
таблицы пользователей. Поля журнала не редактируются и не удаляются API.

---

## 5. Серверный слой

Новые модули:

- `lib/admin-orders.ts` — чистая валидация query-параметров списка и тела
  отмены/переходов исполнения; не импортирует Next.js или БД.
- `lib/admin-orders-db.ts` — DTO, SQL-запросы списка/деталей и транзакционная
  `cancelAdminOrder`/`transitionFulfillment`.
- `lib/store-settings.ts` — чтение и валидация тарифа СДЭК; цена всегда в
  копейках, `0` — явная бесплатная доставка.
- `lib/cdek.ts` — серверная OAuth-обёртка API CDEK. Виджет выбирает точку на
  клиенте через `/api/cdek`, а `createOrder` повторно запрашивает API по коду,
  подтверждает доступность и нормализует snapshot `{ code, city, name, address }`.
  В ней не создаются накладные.

Никакой код списка не использует публичный `getOrderByToken`: тот метод
специально ограничен неугадываемым URL покупателя. Админка обращается к заказу
только по числовому `id` после `requireAdminApi`/`requireAdminPage`.

### 5.1. Оформление и snapshot

`OrderInput` расширяется объектом `delivery` и ожидаемой полной суммой. Значения
`expected*` не являются ценой от клиента: это обязательные неотрицательные
целые копейки, нужные только для обнаружения изменившегося тарифа или цены
товаров перед созданием заказа.

```ts
type DeliveryInput = {
  method: 'cdek_pickup'
  pickupPointCode: string
  expectedDeliveryKopecks: number
}

type OrderInput = {
  customerName: string      // ФИО получателя
  customerEmail: string
  customerPhone: string     // обязательный телефон получателя
  delivery: DeliveryInput
  expectedTotalKopecks: number
  items: { slug: string; quantity: number }[]
}
```

Перед созданием заказа сервер валидирует код ПВЗ через `lib/cdek.ts`. В одной
транзакции он блокирует выбранные товары и строку `store_settings`, получает
`itemsKopecks`, берёт установленный `deliveryKopecks`, складывает их в
`totalKopecks` и сохраняет все delivery-поля. Если `expectedDeliveryKopecks`
или `expectedTotalKopecks` не совпали с расчётом, транзакция не создаёт заказ и
init отвечает `409 PRICE_CHANGED` с `{ itemsKopecks, deliveryKopecks,
totalKopecks }`. Повторная отправка с этими значениями — явное подтверждение
покупателя. В Робокассу и её подпись уходит полный `totalKopecks` — клиент не
может уменьшить доставку или заменить ПВЗ.

Если настройки нет, ПВЗ недоступен или СДЭК временно недоступен, заказ не
создаётся: соответственно `503 DELIVERY_UNAVAILABLE` или `400
DELIVERY_VALIDATION_ERROR`. Никакого неявного fallback на бесплатную доставку и
произвольного текста ПВЗ нет.

`markOrderPaid` также использует `withTransaction`: читает заказ с блокировкой,
проверяет сумму и атомарно делает `pending/awaiting_payment → paid/new` вместе с
`robokassa_data`. Это обязательная часть миграции `003`: одиночный `UPDATE
status='paid'` нарушит `orders_payment_fulfillment_check`.

### 5.2. DTO

Во всех API — camelCase; денежные значения — целые копейки.

```ts
type OrderStatus = 'pending' | 'paid' | 'cancelled'
type FulfillmentStatus = 'awaiting_payment' | 'new' | 'packing' | 'handed_to_carrier' | 'delivered' | 'cancelled'

type AdminOrderListItem = {
  id: number
  customerName: string
  customerEmail: string
  customerPhoneMasked: string | null
  totalKopecks: number
  status: OrderStatus
  fulfillmentStatus: FulfillmentStatus
  itemCount: number          // сумма quantity, а не число строк
  createdAt: string          // RFC 3339 UTC
}

type AdminOrderItem = {
  productName: string
  priceKopecks: number
  quantity: number
}

type AdminOrderEvent = {
  id: number
  eventType: 'cancelled' | 'fulfillment_transition'
  reason: string | null
  fromFulfillmentStatus: FulfillmentStatus
  toFulfillmentStatus: FulfillmentStatus
  trackingNumber: string | null
  actorLoginAt: number
  createdAt: string
}

type AdminOrderDetail = Omit<AdminOrderListItem, 'customerPhoneMasked'> & {
  customerPhone: string | null
  invId: number | null
  itemsKopecks: number
  deliveryKopecks: number
  deliveryCarrier: 'cdek' | null
  deliveryMethod: 'cdek_pickup' | null
  pickupPoint: null | { code: string; city: string; name: string; address: string }
  trackingNumber: string | null
  items: AdminOrderItem[]
  adminEvents: AdminOrderEvent[]
}
```

`token` и сырые `robokassaData` не возвращаются: они не нужны для операционной
работы и не должны попадать в браузер или логи фронтенда. `invId` показывается
только в карточке как идентификатор для сверки с ЛК Робокассы.

### 5.3. Выборка и пагинация

`listAdminOrders(filters)` возвращает список в порядке `created_at DESC, id DESC`.
Курсор — base64url-кодировка `{ createdAt: string, id: number }`; сервер
декодирует и полностью валидирует её. Следующая страница выбирается условием:

```sql
(o.created_at, o.id) < ($cursorCreatedAt, $cursorId)
```

Запрашивается `limit + 1` строка, лишняя определяет `nextCursor`. Это устраняет
дубли при одинаковом `created_at` и не требует дорогого `OFFSET`.

Для каждой строки `itemCount` считается в SQL через `COALESCE(SUM(oi.quantity),
0)`. Деталь читает заказ, позиции в `ORDER BY oi.id` и журнал в `created_at DESC,
id DESC`. Отсутствующий заказ — `undefined`/`404`.

### 5.4. Отмена

`cancelAdminOrder(id, reason, actorLoginAt)` выполняется в одной транзакции:

1. `UPDATE orders SET status = 'cancelled', fulfillment_status = 'cancelled'
   WHERE id = $1 AND status = 'pending' RETURNING ...`.
2. Если строка обновлена — `INSERT order_admin_events` с причиной, сессией и
   переходом `awaiting_payment → cancelled`.
3. `COMMIT`, затем вернуть обновлённый `AdminOrderDetail`.
4. Если строка не обновлена, определить причину отдельным чтением в той же
   транзакции: нет заказа → `not_found`; другой статус → `not_pending`.

Любая ошибка вставки журнала откатывает смену статуса. Нельзя сначала менять
статус, а затем пытаться «дописать лог» отдельным запросом.

### 5.5. Исполнение

`transitionFulfillment(id, nextStatus, trackingNumber, actorLoginAt)` в одной
транзакции блокирует заказ `FOR UPDATE`, проверяет статус оплаты и разрешённый
переход, обновляет `fulfillment_status` (и трек для `handed_to_carrier`), затем
пишет `fulfillment_transition` в `order_admin_events`.

Доступны только:

```text
status='paid', fulfillment_status='new' → packing → handed_to_carrier → delivered
```

`handed_to_carrier` требует непустой трек-номер длиной 5–64 символа; в других
переходах `trackingNumber` отсутствует. Нельзя менять исполнение `pending` или
`cancelled` заказа, перепрыгивать шаги или менять `delivered` назад. Ошибка
перехода — `409 FULFILLMENT_TRANSITION_INVALID` без частичного изменения.

---

## 6. API

Все методы ниже используют JSON и общий конверт ошибок:

```ts
{ error: { code: string; messages: string[] } }
```

Каждый handler **до** чтения query/body и обращения к БД вызывает
`requireAdminApi()`. Изменяющий handler затем вызывает `assertSameOrigin()`.
Успешные ответы и ошибки с PII отдаются с `Cache-Control: private, no-store`.

| Метод и путь | Назначение |
| --- | --- |
| `GET /api/admin/orders` | постраничный список |
| `GET /api/admin/orders/[id]` | одна полная карточка |
| `POST /api/admin/orders/[id]/cancel` | отменить `pending`-заказ |
| `POST /api/admin/orders/[id]/fulfillment` | зафиксировать следующий шаг исполнения |
| `GET /api/admin/settings/delivery` | прочитать тариф СДЭК до ПВЗ |
| `PATCH /api/admin/settings/delivery` | задать единый тариф СДЭК до ПВЗ, включая бесплатный |
| `GET /api/checkout/delivery` | публично получить текущий тариф для отображения и подтверждения checkout |

### 6.1. `GET /api/admin/orders`

Параметры:

| Параметр | Формат и default |
| --- | --- |
| `status` | `all` (default), `pending`, `paid`, `cancelled` |
| `dateFrom` | опционально, `YYYY-MM-DD` в часовом поясе `Europe/Moscow` |
| `dateTo` | опционально, `YYYY-MM-DD`, не раньше `dateFrom` |
| `q` | опционально: 1–100 цифр для номера/телефона либо 2–100 символов для имени/email |
| `limit` | 30 (default), целое 1–100 |
| `cursor` | опциональный валидный курсор из предыдущего ответа |

`dateFrom` включает начало московского дня, `dateTo` включает весь московский
день; SQL использует полуоткрытый интервал `[from, to + 1 day)`. Цифровой запрос
ищет `id = q OR` нормализованный телефон содержит `q`; текстовый выполняет
параметризованный case-insensitive поиск по `customer_name` и `customer_email`.
В первом релизе объём заказов мал, поэтому отдельный full-text
или trigram-индекс не вводится.

Успешный ответ:

```ts
{
  orders: AdminOrderListItem[]
  nextCursor: string | null
}
```

Некорректный фильтр/дата/cursor → `400 VALIDATION_ERROR`; без сессии → `401
UNAUTHORIZED`.

### 6.2. `GET /api/admin/orders/[id]`

`id` — положительное целое. Успех — `200 AdminOrderDetail`; несуществующий заказ
— `404 NOT_FOUND`; невалидный id — `400 VALIDATION_ERROR`.

### 6.3. `POST /api/admin/orders/[id]/cancel`

Тело принимается только в форме:

```ts
{ reason: string }
```

При успехе — `200 AdminOrderDetail` с новым статусом и первым элементом
`adminEvents`. Ошибки: неверное тело → `400 VALIDATION_ERROR`; заказ не найден →
`404 NOT_FOUND`; `paid`/`cancelled` → `409 ORDER_NOT_PENDING`; неверный Origin →
`403 FORBIDDEN`.

Маршрут не принимает произвольный `status`, `totalKopecks`, позиции или данные
Робокассы. Никаких `PATCH /api/admin/orders/[id]` в этой фазе нет.

### 6.4. `POST /api/admin/orders/[id]/fulfillment`

Тело строго одного из видов:

```ts
{ status: 'packing' }
{ status: 'handed_to_carrier', trackingNumber: string }
{ status: 'delivered' }
```

Успех — `200 AdminOrderDetail`. Невалидное тело → `400`; недопустимый шаг или
попытка изменить неоплаченный/отменённый заказ → `409`; несуществующий заказ →
`404`. Для всех POST обязательны session и same-origin.

### 6.5. Настройка тарифа

`GET /api/admin/settings/delivery` возвращает
`{ cdekPickupDeliveryKopecks, updatedAt, updatedByActorLoginAt }` либо
`404 SETTINGS_NOT_CONFIGURED`.
`PATCH` принимает ровно `{ cdekPickupDeliveryKopecks: number }`, только целое
число копеек `>= 0`, и возвращает сохранённую настройку. Он требует admin-сессию
и same-origin. Установка влияет лишь на последующие заказы: delivery snapshot
существующих заказов неизменяем.

`GET /api/checkout/delivery` не требует admin-сессии и возвращает
`{ cdekPickupDeliveryKopecks }` с `Cache-Control: no-store`; если тариф не
настроен — `503 DELIVERY_UNAVAILABLE`. Checkout использует его для показа
доставки и посылает эту величину как `expectedDeliveryKopecks` при init.

---

## 7. Страницы и UX

### 7.1. Навигация

В защищённой шапке добавляются ссылки «Товары» (`/admin`) и «Заказы»
(`/admin/orders`), а также «Настройки» → «Доставка». Активный раздел визуально
выделен. Logout остаётся тем же.

### 7.2. Checkout: ПВЗ СДЭК и оплата доставки

Форма оформления меняется до оплаты, а не после неё:

1. «ФИО получателя» — обязательное поле; текущее поле «Имя» переименовывается.
2. Email остаётся обязательным.
3. «Телефон получателя» становится обязательным, нормализуется на сервере и
   объясняется как нужный для выдачи в СДЭК.
4. Кнопка «Выбрать пункт выдачи СДЭК» открывает официальный виджет/интеграцию.
   Покупатель выбирает точку на карте или из списка; после callback в форме
   остаётся только читаемая карточка `город · название · адрес`. Ручной ввод,
   редактирование кода и отправка формы без выбранной точки невозможны.
5. Сводка показывает «Товары», «Доставка СДЭК до ПВЗ» и «К оплате». Последнее
   равно серверному `items + delivery`; кнопка имеет текст «Оплатить заказ с
   доставкой».

До готовности виджета и загрузки тарифа кнопка оплаты disabled. Ошибка выбора
или проверки ПВЗ не очищает корзину. При `409 PRICE_CHANGED` checkout заменяет
показанные `Товары`, `Доставка` и `К оплате` значениями из ответа, не создаёт
заказ и просит повторно нажать кнопку. Повторный init несёт новые
`expectedDeliveryKopecks` и `expectedTotalKopecks`; только он может открыть
Робокассу.

### 7.3. Настройки `/admin/settings/delivery`

Экран содержит одно поле «Стоимость доставки СДЭК до ПВЗ, ₽» и переключатель
«Бесплатная доставка» (сохраняет `0` копеек). Он показывает, когда и какой
сессией тариф менялся последним, сохраняет значение в копейках и просит явное
подтверждение: «Новая цена применяется только к будущим заказам». Отрицательную
цену и текстовые рубли форма не принимает. Пока настройка не создана, на экране
виден блокирующий статус «Оформление отключено».

### 7.4. Список `/admin/orders`

Страница — Server Component с `export const dynamic = 'force-dynamic'`, вызывает
`requireAdminPage()` через защищённый layout и получает первую страницу с сервера.
В браузерный компонент передаются только DTO первой страницы и параметры фильтра.

Экран содержит:

- заголовок «Заказы»;
- табы «Все», «Ожидают оплаты», «Оплачены», «Отменены»;
- поле поиска с плейсхолдером «№ заказа, имя, email или телефон»;
- два поля периода «с»/«по»; фильтры синхронизируются с query string, сбрасывают
  cursor и применяются без неявного сохранения;
- таблицу/карточки с №, датой и временем, получателем (ФИО + email), количеством
  единиц, суммой, цветным платёжным статусом и коротким статусом исполнения;
- клик по строке открывает `/admin/orders/[id]`; кнопка «Загрузить ещё» видна
  только при `nextCursor`.

Дата показывается в `ru-RU`, `Europe/Moscow`; деньги — через существующий
`formatRub`. Пустая выдача имеет понятную причину «Заказы по выбранным условиям
не найдены». В списке не показываются token, `invId`, сырые платёжные данные и
полный телефон.

### 7.5. Карточка `/admin/orders/[id]`

Показывает:

- номер, дату/время, платёжный и исполнительский статусы, итог и `invId` (если
  присвоен);
- контакты получателя: ФИО, email, телефон;
- ПВЗ СДЭК: город, название, адрес и код; код доступен кнопкой копирования, но
  не редактируется;
- позиции: snapshot-название, цена за единицу, количество, сумма строки;
  отдельные строки «Товары», «Доставка СДЭК» и «К оплате»;
- трек-номер СДЭК после передачи отправления;
- журнал ручных действий с причиной, датой и пометкой «администратор»;
- кнопку «Отменить заказ» только при `status='pending'` и контекстную кнопку
  следующего шага исполнения у оплаченного заказа.

Нажатие «Отменить заказ» открывает modal с обязательным текстовым полем. В нём
явно написано: «Отмена необратима. Если платёж уже проходит, деньги могут
поступить после отмены — такой случай нужно сверить в Робокассе вручную». После
успеха карточка перерисовывается по ответу API; кнопка исчезает. `409` показывает
актуальное состояние и предлагает обновить карточку.

Для узких экранов список и карточка остаются читаемыми: строки превращаются в
вертикальные карточки, но состав, контакты и действие не скрываются.

---

## 8. Безопасность и приватность

- I8 обязателен для обеих страниц и всех `/api/admin/orders/**` и
  `/api/admin/settings/**`: до успешной
  сессии не читать body, не запрашивать БД и не раскрывать существование заказа.
- Для каждого `POST`/`PATCH` после auth обязателен `assertSameOrigin`; cookie остаётся
  `HttpOnly`, `Secure` в production и `SameSite=Lax` по уже принятой модели.
- Заказы содержат персональные данные. Их нельзя писать в `console`, URL/query
  аналитики, toast-ошибки или клиентские telemetry-события. API и страницы не
  кэшируются в браузере/прокси.
- SQL — только параметризованный. `q`, даты, limit, cursor и id валидируются
  до запроса; `limit` ограничен 100.
- По умолчанию в списке маскируется телефон (например, `+7 ••• •••-12-34`);
  полный номер доступен только в карточке уже авторизованному администратору.
- Логи сервера для отказов содержат только технический контекст (`orderId`, код
  ошибки), не имя, email, телефон, token или причину отмены.

---

## 9. Критерии приёмки

- [ ] Без настройки тарифа checkout не создаёт заказ и не открывает Робокассу;
  после явной настройки он показывает стоимость доставки, включая `0` для
  бесплатной доставки.
- [ ] Заказ нельзя оформить без ФИО, телефона и подтверждённого ПВЗ. Сервер
  отвергает подменённый/недоступный код ПВЗ и любую клиентскую цену доставки.
- [ ] В Робокассу уходит `itemsKopecks + deliveryKopecks`; тариф и ПВЗ
  сохраняются в заказе и не меняются задним числом. При изменении цены до init
  сервер не создаёт заказ и возвращает `409 PRICE_CHANGED` с новой суммой.
- [ ] Неавторизованный admin-запрос не читает БД; API отвечает `401`, страницы
  редиректят на `/admin/login`.
- [ ] Список keyset-пагинируется без дублей; карточка показывает snapshot
  позиций, доставки и ПВЗ, даже если товар/тариф уже изменился.
- [ ] ResultURL переводит только `pending/awaiting_payment → paid/new` после
  проверки подписи и полной суммы; ручного `paid` нет.
- [ ] `pending` отменяется только с причиной и атомарным аудитом. Исполнение
  оплаченного заказа проходит только `new → packing → handed_to_carrier →
  delivered`; передача без трек-номера отклоняется.
- [ ] PII не попадают в URL, клиентские ошибки и логи; API имеют `private,
  no-store`. Checkout, список и карточка доступны на мобильном.

---

## 10. Тесты

**Unit:** валидаторы тарифа (включая `0`)/ПВЗ/телефона и переходов, snapshot
полной суммы, `PRICE_CHANGED`, мок `lib/cdek.ts`, маскирование `null` и
ненормализованного legacy-телефона, поздняя оплата отменённого заказа и
`paid → new`.

**Интеграционные:** миграция `003` (идемпотентность и legacy-backfill),
`createOrder` и init с тарифом/ПВЗ, ResultURL с полной суммой, admin API
заказов/исполнения/настроек, аудит и гонка cancel/result.

**E2E:** админ задаёт тариф → покупатель выбирает ПВЗ → видит полную сумму и
оплачивает → владелец фиксирует сборку, передачу СДЭК с треком и выдачу;
отдельно — отмена неоплаченного заказа.

Readiness-гейт: `npm run typecheck && npm test && npm run build` из `shop/`.

---

## 11. Rollout и документация

1. Перед rollout сделать `pg_dump`, применить миграцию
   `003_orders_delivery_and_admin_events.sql` и проверить её результат.
2. Оставить `DELIVERY_ENABLED=false`; проверить создание заказа и ResultURL без
   ПВЗ/доставки.
3. Отдельно пройти Пауза 2 перед включением СДЭК, добавить OAuth-ключи и задать
   тариф через admin UI.
4. После подтверждённого rollout отметить production-статус в `ROADMAP.md`,
   `docs/environments.md` и этом документе.

Любая операция на production и применение миграции требуют Паузы 1. Rollback
кода не удаляет delivery/audit-данные: они остаются целой историей заказов.

---

## 12. Зафиксированные продуктовые решения

1. Первый релиз: только доставка в ПВЗ СДЭК по РФ; самовывоза, курьера и других
   перевозчиков нет. Snapshot-структура нейтральна к перевозчику для следующих
   фаз.
2. Цена — единый фиксированный тариф из админки, включая явный `0` для
   бесплатной доставки, не ручная доплата и не расчёт СДЭК. Она оплачивается до
   создания заказа и становится snapshot.
3. ПВЗ выбирается из официальных данных; код плюс город/название/адрес хранятся
   в заказе. Свободный текст точки не допускается.
4. Накладная создаётся вручную в ЛК СДЭК; владелец заносит трек. Автоматический
   трекинг, возвраты и уведомления — следующие отдельные фазы.

---

## 13. Критика решения и gate Паузы 2

ПВЗ **сам по себе** не достаточен: СДЭК указывает ФИО, телефон и адрес/ПВЗ
получателя как нужные данные. Поэтому нельзя принимать «ПВЗ на Ленина» в
свободном поле: точки похожи, меняются и могут закрыться. Нужны ФИО, телефон,
подтверждённый код ПВЗ и его текстовый snapshot.

Единая цена — хороший MVP: простая и прозрачная, без веса и габаритов в
каталоге. Но она рискованна для маржи: фактическая цена СДЭК зависит от
направления и габаритов, а свечи тяжёлые. Тариф нельзя менять задним числом или
просить доплату после оплаты. До запуска нужно проверить реальные отправки из
города продавца в дальние регионы и выбрать: ограничить географию, заложить
максимальную цену или осознанно покрывать разницу маржой.

Официальный виджет — не «просто поле»: он использует протокол СДЭК, а его
документация предупреждает о совместимости с Яндекс.Картами и глобальным Reset
CSS. Нужны изолированное встраивание, мобильная проверка и server-side
подтверждение ПВЗ. Это новая внешняя интеграция, поэтому по `PROJECT_CORE.md`
§2 требуется Пауза 2 — явное подтверждение владельца перед кодом.

Рекомендация: принять узкий первый релиз из §12, но отдельно одобрить
интеграцию СДЭК. После 20–30 отправлений сравнить фактические расходы с
тарифом; при существенном разбросе следующей фазой делать расчёт СДЭК по весу,
габаритам и направлению, а не ручные исключения.
