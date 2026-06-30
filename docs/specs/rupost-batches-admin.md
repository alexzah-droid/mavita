# Почта России — worker, партии и админка

**Статус:** планируемая фаза после адресного checkout и API-revalidation.  
**Актуализировано:** 2026-06-30.  
**Зависит от:** [rupost-api-revalidation.md](rupost-api-revalidation.md),
[rupost-address-checkout.md](rupost-address-checkout.md).  
**Не реализовано в коде.**

---

## Цель

После оплаты безопасно создать отправление Почты России, собрать партии,
распечатать формы и зафиксировать сдачу перевозчику без ручного копирования
данных из заказа.

Главное правило: внешние вызовы Почты не выполняются в `robokassa/result`.
Оплата только ставит локальную задачу, а worker обрабатывает её асинхронно.

---

## Доменная модель

### `rupost_shipments`

Одна строка на один заказ, одновременно outbox и доменная сущность отправления.

Ключевые поля:

- `order_id UNIQUE`;
- `status`: `pending`, `creating`, `backlog`, `batch_pending`, `in_batch`,
  `handed`, `failed`;
- `remote_id`: id заказа у Почты до появления ШПИ;
- `barcode`: ШПИ, появляется после партии;
- `order_num`: идемпотентный ключ, обычно `String(order.id)`;
- `batch_id`;
- `attempt_count`, `available_at`, `locked_at`, `claim_token`, `last_error`.

`claim_token` обязателен: он защищает от позднего ответа старого worker после
TTL-reclaim.

### `rupost_batches`

Одна строка на партию Ф103.

Ключевые поля:

- `remote_batch_name`;
- `sending_date`;
- `status`: `pending_create`, `creating`, `open`, `pending_checkin`,
  `checking_in`, `checked_in`, `handed`, `needs_review`;
- `attempt_count`, `available_at`, `locked_at`, `claim_token`, `last_error`;
- `created_by_actor_login_at`.

`needs_review` — ручной стоп. Worker не делает blind retry, если состояние у
Почты неоднозначно.

---

## После оплаты

Внутри транзакции `markOrderPaid`, рядом с уведомлением:

```sql
INSERT INTO rupost_shipments (order_id, order_num, status)
SELECT id, id::text, 'pending'
FROM orders
WHERE id = $1 AND delivery_carrier = 'rupost'
ON CONFLICT (order_id) DO NOTHING;
```

Повторный ResultURL не плодит задачи. Если заказ не `rupost`, ничего не
создаётся.

---

## Worker `rupost:drain`

Один worker обрабатывает и отправления, и партии.

Паттерн:

1. Sweep зависших `creating`/`checking_in` по TTL:
   - вернуть в idle-статус;
   - обнулить `claim_token`;
   - следующий проход делает reconciliation.
2. Claim:
   - `pending|failed -> creating` для shipment;
   - `pending_create -> creating` или `pending_checkin -> checking_in` для batch;
   - в той же транзакции поставить новый `claim_token`.
3. Remote call.
4. Settle только с `WHERE claim_token=$token`.
5. При неоднозначности партии — `needs_review`, без автоматического повторного
   create/check-in.

Для backlog-создания перед повторным create всегда делать search/reconcile по
`order_num`, чтобы timeout после успешного remote create не создал дубль.

---

## Админский флоу партии

1. **Готовы к отправке**
   - Показывать `rupost_shipments.status='backlog'`.
   - Оператор выбирает строки и дату сдачи.

2. **Собрать партию**
   - Локальная транзакция фиксирует состав:
     `backlog -> batch_pending`, создаёт `rupost_batches.pending_create`.
   - Remote create делает worker, не admin request.

3. **Открытая партия**
   - После успешного worker reconcile:
     batch `open`, shipments `in_batch`, у shipments есть `barcode`.
   - Можно печатать Ф7п и Ф103.

4. **Check-in**
   - Оператор переводит `open -> pending_checkin`.
   - Worker вызывает remote check-in и переводит в `checked_in`.

5. **Сдано**
   - Оператор физически сдаёт посылки и нажимает «Сдано».
   - Локальная транзакция:
     - batch `checked_in -> handed`;
     - shipments `in_batch -> handed`;
     - orders переходят в `handed_to_carrier`;
     - `orders.tracking_number = rupost_shipments.barcode`;
     - пишется `order_admin_events`;
     - ставится уведомление покупателю, если оно включено.

---

## Трек для клиента

До сдачи barcode может уже быть в `rupost_shipments`, но не в
`orders.tracking_number`. На `/order/[token]` можно показывать трек из join с
`rupost_shipments`, если он есть:

```text
https://www.pochta.ru/tracking#<barcode>
```

При сдаче barcode копируется в `orders.tracking_number`, чтобы текущий
fulfillment constraint оставался валидным.

---

## Acceptance criteria

- [ ] `robokassa/result` не вызывает Почту напрямую.
- [ ] Повторный callback не создаёт второй `rupost_shipments`.
- [ ] Два worker не могут одновременно обработать одну строку.
- [ ] Поздний ответ старого worker после TTL не может записаться в чужой claim.
- [ ] Timeout после remote create не создаёт дубль без reconciliation.
- [ ] Партия при неоднозначном remote-состоянии уходит в `needs_review`.
- [ ] Ф7п/Ф103 доступны только после появления batch/barcode.
- [ ] Сдача партии проставляет `orders.tracking_number` из barcode и пишет
      admin event.
