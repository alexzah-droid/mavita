# Ozon Доставка — жизненный цикл отправления (order/create)

Статус: **черновик мини-спеки, к реализации НЕ готова**: предыдущая фаза
заблокирована неподтверждённым режимом непубличной карточки; после её снятия
нужны собственный discovery gate и зелёный smoke.
Дата: 2026-06-21.
Зависит от: [каталог и остатки FBS](ozon-fbs-catalog-sync.md) (карточки + остаток
на FBS-складе — предусловие), [выбор ПВЗ Ozon](done/ozon-pvz.md) (реализовано),
[админка заказов](done/admin-orders.md), [мульти-перевозчик](delivery-options.md).

## Контекст и цель

Предыдущая фаза должна синхронизировать непубличные карточки FBS и FBS-лимит,
но сейчас она заблокирована. Эта фаза
замыкает поток: после оплаты на сайте автоматически создаёт **отправление
(posting) в Ozon Доставке**, ведёт его статус и трек до выдачи в ПВЗ-получателя,
обрабатывает отмену. Только после неё Ozon можно открыть покупателю на checkout.

Сейчас (факт по коду): отправление Ozon **не создаётся** — оператор делает его
вручную в ЛК Ozon и вписывает трек в админку (`new → packing →
handed_to_carrier(+трек) → delivered`, [AdminOrderActions](../../shop/app/admin/AdminOrderActions.tsx)).
Эта фаза заменяет ручной шаг для Ozon на программный `v2/order/create`; СДЭК
остаётся ручным.

## Главный архитектурный инвариант: НЕ в платёжной транзакции

`markOrderPaid` ([lib/orders.ts](../../shop/lib/orders.ts)) выполняется внутри
server→server `POST /api/robokassa/result`, который обязан быстро и надёжно
ответить `OK{InvId}`. **Синхронный HTTP к Ozon в этом пути запрещён**: Ozon
медленный/недоступный → Робокасса не получит OK → повторы и риск. Поэтому модель —
**outbox + воркер**, ровно как уже сделано для Telegram-уведомлений
(`enqueueOrderNotification` + `npm run notifications:drain` по systemd-таймеру).

```
robokassa/result → markOrderPaid (txn): status=paid, fulfillment_status=new,
                   + enqueue ozon_shipment task (idempotent по order_id)   ← НИКАКОГО HTTP
                            │
            systemd timer → worker drain → v2/order/create (идемпотентно) → posting_number+трек
                            │
            периодический  → опрос статуса posting → маппинг в fulfillment_status
```

## Границы фазы

### Входит
- создание отправления Ozon после подтверждённой оплаты (idempotent по `orders.id`);
- хранение `posting_number`, трека, статуса и ошибок отправления;
- синхронизация статуса posting → `fulfillment_status` и трек покупателю;
- отмена отправления при отмене заказа; безопасные ошибки оператору;
- этикетка/маркировка (получение и хранение/печать ярлыка);
- открытие Ozon на checkout **только** по `OZON_LOGISTICS_ORDER_FLOW_ENABLED=true`
  после end-to-end smoke.

### Не входит
- расчёт реального тарифа Ozon на checkout (тариф остаётся фикс/бесплатно);
- возвраты денег покупателю (это поток Робокассы/оператора, не Ozon API);
- курьерская доставка «до двери» (только ПВЗ-получатель этой фазы);
- изменение модели каталога/остатков (берётся из предыдущей фазы как есть).

## Решения и инварианты

| Вопрос | Решение |
|---|---|
| Точка вызова | Только после `status=paid` (Ozon: order/create возможен лишь после оплаты). Вызов из воркера, не из request lifecycle. |
| Идемпотентность | Один `orders.id` ⇒ ровно один posting. Idempotency key = `orders.id`/`orders.token`; перед create проверять, нет ли уже `posting_number`. |
| Источник правды по составу/цене | Снимок заказа МАВИТА (`order_items`, `total`). Ozon не пересчитывает суммы заказа. |
| ПВЗ-получатель | `pickup_point_code` из снимка заказа (уже выбран покупателем). |
| ПВЗ/пункт отправителя | first-mile `DROP_OFF` выбранного FBS-склада (настроен в ЛК, не на заказ). |
| FBS-лимит | `ozon_product_profiles.fbs_stock_quantity` — отдельная квота Ozon, не наличие сайта. Момент резервирования/списания и компенсации подтверждается discovery (см. «FBS-лимит»). |
| Трек | `tracking_number` заполняется из posting, а не вручную, для carrier=`ozon`. |
| Отмена | Отмена заказа → отмена posting через Ozon cancel API с документированной причиной; необратимое удаление запрещено. |
| Feature gate | `OZON_LOGISTICS_ORDER_FLOW_ENABLED` гейтит и предложение Ozon на checkout, и воркер create. |

## Discovery gate этой фазы (отдельный, обязателен)

Предыдущий discovery покрыл read-методы и каталог. Здесь нужно подтвердить
**живым ключом** перед кодом (зафиксировать версии и тела ответов, без секретов):

1. `v2/delivery/checkout` — проверка доставимости в выбранный ПВЗ и получение
   параметров (нужен ли он перед create или create самодостаточен);
2. `v2/order/create` — точный контракт создания отправления из заказа стороннего
   магазина: какие поля груза/получателя/ПВЗ обязательны, как передаётся состав;
3. методы FBS-posting: список/детали/сборка-отгрузка (ship), **этикетка**
   (package-label), **отмена** (cancel) и справочник причин отмены — точные пути
   и версии (`v3/posting/fbs/*`, `v2/posting/fbs/*` — подтвердить, не брать из
   старых статей);
4. справочник статусов posting и их переходы → составить маппинг (ниже);
5. **роли ключа** для create/ship/label/cancel: текущий ключ —
   `Product`/`Description Category`/`Warehouse`; create/ship почти наверняка
   требуют роль `Posting FBS` (либо более узкую подтверждённую роль) — при `403` зафиксировать недостающую
   роль, **не повышать до `Admin`**; вероятно нужен **новый ключ с этой ролью**.

Если контракт create для модели «заказ со своего магазина» не подтверждается —
фаза не выпускается, в `docs/operations.md` блокер с источником и текстом ответа.

## Модель данных

Новая миграция после завершённой catalog-фазы, номер — по факту.

### Таблица отправлений Ozon

```sql
CREATE TABLE ozon_shipments (
  order_id            INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  posting_number      TEXT UNIQUE,
  ozon_status         TEXT,                 -- сырой статус Ozon (для аудита)
  tracking_number     TEXT,
  label_url           TEXT,                 -- или путь к сохранённому ярлыку
  state               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (state IN ('pending','created','shipped','delivered','cancelled','failed')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_error_code     TEXT,
  last_error_message  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`order_id` PRIMARY KEY гарантирует идемпотентность (один заказ — одна строка/
posting). `ON DELETE RESTRICT` — заказ с отправлением нельзя удалить.

### Outbox-задача

Переиспользовать механизм уведомлений или завести отдельную таблицу
`ozon_shipment_tasks` с `order_id`, `state`, `attempt_count`, `next_attempt_at`,
fencing/lease (как у sync-задач предыдущей фазы и каталога ПВЗ). Постановка
задачи — в **той же транзакции** `markOrderPaid`, рядом с `enqueueOrderNotification`.

### Расширение fulfillment-переходов

Текущие `orders_fulfillment_status_check` и `order_admin_events` переходы
([003](../../shop/sql/migrations/003_orders_delivery_and_admin_events.sql)) описаны
под **ручной** линейный поток (new→packing→handed_to_carrier(+трек)→delivered) и
требуют трек только на handed_to_carrier. Авто-синхронизация из Ozon потребует:

- нового `order_admin_events.event_type='carrier_status_sync'` (актор — система,
  не оператор) ИЛИ ослабления CHECK переходов для carrier=`ozon`;
- разрешения проставлять `tracking_number` при авто-создании posting раньше ручного
  «Передать перевозчику».

Это решается миграцией; ручной поток СДЭК не менять.

## Алгоритм воркера (один заказ, идемпотентно)

1. Lease задачи (fencing), прочитать заказ + `ozon_shipments` под блокировкой.
2. Если `posting_number` уже есть — пропустить create, перейти к синхронизации
   статуса. (Защита от дубля при повторе.)
3. Проверить предусловия: carrier=`ozon`, `status=paid`, товары заказа имеют
   синхронизированные профили (`remote_state='synced'`) и достаточный остаток.
4. (Опц.) `v2/delivery/checkout` — подтвердить доставимость в выбранный ПВЗ.
5. `v2/order/create` с idempotency-ключом из `orders.id`. На сетевых/`429/5xx` —
   retry с backoff; на бизнес-ошибке (`400`/нет остатка) — `state='failed'`,
   безопасная причина, алерт оператору, **без зацикливания**.
6. Сохранить `posting_number`, `state='created'`, при наличии — трек.
7. Получить этикетку (package-label), сохранить `label_url`/файл.
8. Записать трек в `orders.tracking_number` и перевести `fulfillment_status`
   согласно маппингу; событие `carrier_status_sync`; уведомление покупателю
   (трек) при необходимости.

Отдельный периодический проход опрашивает posting’и в неконечном статусе и
двигает `fulfillment_status` до `delivered`.

### Маппинг статусов (черновик — финал после discovery п.4)

| Ozon posting (ожидаемо) | `ozon_shipments.state` | `orders.fulfillment_status` |
|---|---|---|
| создан / awaiting_packaging | created | new |
| собран, ждёт сдачи / awaiting_deliver | shipped | handed_to_carrier (+трек) |
| в пути / delivering | shipped | handed_to_carrier |
| доставлен / delivered | delivered | delivered |
| отменён / cancelled | cancelled | (заказ cancelled) |

## FBS-лимит

`fbs_stock_quantity` — не складской остаток сайта и никогда не изменяет
`products.in_stock`, витрину или checkout. До реализации нужно живым API
подтвердить, резервирует ли Ozon лимит в момент `order/create`, и определить
единственный атомарный момент локального изменения: только после успешного
создания posting. При неуспехе create и при подтверждённой отмене posting лимит
восстанавливается. Списание при оплате сайта запрещено: на этой точке posting
ещё не создан и Ozon может отвергнуть заказ.

## Отмена и возврат

- Отмена заказа в админке (`status=cancelled`) для carrier=`ozon` с уже созданным
  posting → вызвать Ozon cancel API с причиной из справочника; `ozon_shipments.state='cancelled'`.
- Если posting ещё не создан — просто отменить задачу из outbox.
- Возврат денег покупателю — вне Ozon API (Робокасса/оператор), как сейчас.
- Гонка «оплата пришла после отмены» уже отмечена в текущем UI — для Ozon
  дополнительно: не создавать posting, если заказ к моменту drain уже `cancelled`.

## Feature gate

`OZON_LOGISTICS_ORDER_FLOW_ENABLED` (literal `true`):
- `resolveDeliveryMode()`/`getLockedDeliverySnapshot()` исключают `ozon`, пока флаг
  не `true` (уже описано в catalog-sync фазе);
- воркер create не стартует при выключенном флаге;
- включать только после зелёного end-to-end smoke (create→ship→label→delivered и
  отмена) на тестовом заказе.

## Безопасность и наблюдаемость

- Api-Key/Client-Id/payloads не логируются; в UI — только posting_number, статус,
  трек и безопасная причина ошибки.
- Метрики воркера: создано/в работе/failed, возраст незакрытых posting, число
  заказов без posting спустя N минут после оплаты (алерт).
- Персональные данные получателя (имя/телефон) уходят в Ozon только в составе
  create; в логи — не пишутся.

## Тестирование

1. Идемпотентность: повтор drain одного заказа не создаёт второй posting.
2. Воркер не вызывает Ozon из `robokassa/result`; create только из drain.
3. Mock fetch: success, async, `400` (нет остатка), `401/403` (роль), `429/5xx`,
   timeout, malformed.
4. Маппинг статусов posting → fulfillment_status; проставление трека.
5. Отмена: posting есть/нет; «оплата после отмены» не создаёт posting.
6. Feature gate: при `false` Ozon не на checkout и воркер не активен.
7. Миграция: `ozon_shipments` constraints, новый event_type/переходы, RESTRICT.
8. End-to-end smoke с тестовым ключом и явным разрешением владельца.

## Критерии приёмки

- оплаченный Ozon-заказ автоматически получает ровно один posting и трек;
- статус заказа доходит до `delivered` по данным Ozon без ручного ввода трека;
- отмена заказа отменяет posting и не оставляет «висящих» отправлений;
- повтор/сбой воркера не плодит дублей и не теряет заказ;
- ключи нигде не раскрываются; роли минимальны (без `Admin`);
- при `OZON_LOGISTICS_ORDER_FLOW_ENABLED=false` Ozon недоступен на checkout и
  воркер выключен;
- все новые тесты, typecheck и lint проходят.

## Rollout

1. Discovery gate этой фазы (живой ключ, при необходимости новый ключ с FBS-ролью).
2. Миграция `ozon_shipments` + outbox + переходы; деплой с выключенным флагом.
3. systemd-таймер воркера create/sync (по образцу notifications/ozon-sync).
4. Smoke: 1 тестовый заказ → create → этикетка → ship → delivered; затем отмена
   другого тестового заказа.
5. Только после зелёного smoke — `OZON_LOGISTICS_ORDER_FLOW_ENABLED=true` и
   включение Ozon-перевозчика на checkout.
