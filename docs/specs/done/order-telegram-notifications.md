# Спецификация: Telegram-уведомления о событиях заказов

Дата: 2026-06-21
Фаза: после rollout Ф4-К2
Статус: проект спецификации

Связанные документы: [admin-orders.md](admin-orders.md),
[admin-products.md](admin-products.md), [PROJECT_CORE.md](../../../PROJECT_CORE.md),
[docs/tech-debt.md](../../tech-debt.md) (TD-6), [docs/operations.md](../../operations.md).

---

## 0. Итоги критического ревью (2026-06-21)

Ревью сверено с кодом `shop/`. Архитектурно спека реализуема: паттерн
`withTransaction(client => …)` уже используется всеми четырьмя целевыми
функциями; `markOrderPaid` возвращает `'paid'` только при реальном
`UPDATE … RETURNING` (orders.ts), `already_paid` обрабатывается отдельно;
`requireAdminApi`/`assertSameOrigin` существуют; таблица `order_admin_events`
с собственным `id` даёт стабильный `audit_event_id` для `event_key`; нумерация
миграции `004` и конвенция `*_actor_login_at BIGINT` совпадают.

**Решения по ревью внесены в эту версию.** Первый релиз использует
обезличенные сообщения, поэтому отдельный privacy-гейт не блокирует
технический rollout.

1. Для runner добавляется `tsx` в production `dependencies` и скрипт
   `notifications:drain: "tsx scripts/drain-notifications.ts"`. `tsx` читает
   `tsconfig.json`, поэтому server-only импорты и алиасы `@/*` исполняются тем
   же образом, что в коде Next.js. Требование к зависимости и systemd timer
   закреплены в §8.2 и §9.
2. `enqueueOrderNotification` использует ровно
   `INSERT … ON CONFLICT (event_key) DO NOTHING`. Дедупликация не прерывает
   транзакцию заказа или оплаты; это закреплено в §5 и §8.1.
3. Первый релиз не передаёт в Telegram имя, телефон, email, адрес или ПВЗ —
   только номер, статус, сумму, состав заказа, трек (если есть) и ссылку на
   защищённую админку. Расширение до ПДн возможно только отдельной
   спецификацией с обновлением публичной политики. Ссылки на несуществующий
   `docs/privacy` удалены.
4. Канал отключается автоматически только при 401 (неверный или отозванный
   токен). 400/403 помечают конкретное сообщение `failed` и видны в настройке,
   но не глушат следующие уведомления.
5. Добавляется `readNotificationSnapshot(client, orderId)` с двумя запросами
   через переданный transaction client: строка заказа и его `order_items`.
   Функция вызывается после успешного `UPDATE`/audit insert, но до commit;
   глобальный `getAdminOrderById()` не переиспользуется, поскольку не участвует
   в этой транзакции.

Таймаут 10 секунд в §8.2 относится только к запросу `sendMessage`: route
handler не ждёт доставки и отвечает сразу после commit outbox. Ротация ключа
шифрования остаётся вне scope; `chat_id` хранится строкой без приведения к
`Number`.

---

## 1. Цель

После создания заказа и каждого **фактически сохранённого** изменения его
статуса магазин отправляет одно служебное сообщение в заданный Telegram-чат
владельца. Настройка Telegram (токен бота и ID чата) доступна только в
защищённой админке.

Первый релиз — односторонние уведомления. Бот не принимает команды, не имеет
webhook, не меняет заказ и не пишет покупателям. Ошибка Telegram никогда не
отменяет создание заказа, платёж или смену статуса.

## 2. Scope и границы

### В scope

1. Настройка одного Telegram-бота и одного чата через `/admin/settings/notifications`.
2. Уведомления о новом `pending`-заказе, оплате, отмене и переходах исполнения.
3. Надёжная очередь отправки в PostgreSQL: событие не теряется между фиксацией
   заказа и перезапуском приложения.
4. Повторная отправка временно не доставленных сообщений и видимый в админке
   диагностический статус.

### Не в scope

- сообщения покупателю (email, SMS, Telegram);
- кнопки, команды, callback query, webhook, polling `getUpdates`;
- создание накладной, трекинг СДЭК, возвраты, изменение платежа из Telegram;
- несколько ботов, несколько чатов, выбор разных событий для разных чатов;
- тестовая отправка при сохранении настройки. Реальные сообщения появляются
  только по событиям заказа.

## 3. События и условия отправки

Источник истины — изменение строк `orders` и `order_admin_events`, а не HTTP-
ответ, перезагрузка страницы или callback Робокассы сам по себе.

| Код события | Когда создаётся | Сообщение |
| --- | --- | --- |
| `order_created` | В транзакции успешно создан новый заказ `pending` | «Новый заказ №… ожидает оплаты» |
| `payment_paid` | Проверенный ResultURL изменил `pending → paid` | «Заказ №… оплачен» |
| `order_cancelled` | Админ успешно изменил `pending → cancelled` | «Заказ №… отменён» + причина |
| `fulfillment_changed` | Админ успешно изменил исполнение `new → packing`, `packing → handed_to_carrier` или `handed_to_carrier → delivered` | «Заказ №…: <новый статус>»; для передачи перевозчику — трек-номер |

Не создаются сообщения для повторного ResultURL (`already_paid`), неверной
подписи/суммы, отмены или перехода, вернувших `409`, просмотра заказа и
изменения настроек. Таким образом, одна доменная смена состояния порождает не
более одного outbox-события.

Новый заказ уведомляется до оплаты намеренно: владельцу виден поступивший
заказ, но текст явно помечает его как «ожидает оплаты». Это не обещание
покупателю и не повод начинать отгрузку.

## 4. Текст и данные сообщений

Сообщения отправляются обычным `text` без `parse_mode`: названия товаров и
ввод пользователя не могут сломать Markdown/HTML Telegram.

Общий формат (МСК):

```text
МАВИТА · заказ №184
Статус: оплачен
Сумма: 3 600 ₽
Позиции: Симфония камней × 2
Время: 21.06.2026, 14:32 (МСК)
Админка: https://mavita.ru/admin/orders/184
```

- Для `order_created` статус — «ожидает оплаты»; для `order_cancelled` ниже
  добавляется «Причина: …»; для передачи перевозчику — «Трек: …».
- Первый релиз не передаёт в Telegram персональные данные: имя, телефон, email,
  адрес и ПВЗ. Все строки нормализуются, ограничиваются разумной длиной и не
  включают `token` заказа, платёжные подписи, `robokassa_data` или секреты.
- Ссылка ведёт только в защищённую админку. Открытие без admin-сессии остаётся
  на странице логина.

Передача ПДн в Telegram (например, имени или телефона) — отдельная будущая
функция: она требует обновления публичных документов и отдельного решения
владельца. В этот релиз не входит.

## 5. Настройки и миграция

Создаётся миграция `004_telegram_order_notifications.sql`. Она аддитивна и
идемпотентна; `003` должна быть уже применена.

```sql
CREATE TABLE IF NOT EXISTS telegram_notification_settings (
  singleton                     BOOLEAN PRIMARY KEY DEFAULT true
                                CONSTRAINT telegram_notification_settings_singleton_check CHECK (singleton),
  enabled                       BOOLEAN NOT NULL DEFAULT false,
  chat_id                       TEXT,
  bot_token_ciphertext          BYTEA,
  bot_token_iv                  BYTEA,
  bot_token_auth_tag            BYTEA,
  token_last4                   TEXT,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_actor_login_at     BIGINT NOT NULL,
  last_delivery_error           TEXT,
  last_delivery_error_at        TIMESTAMPTZ,
  CONSTRAINT telegram_notification_settings_credentials_check CHECK (
    (bot_token_ciphertext IS NULL AND bot_token_iv IS NULL AND bot_token_auth_tag IS NULL AND token_last4 IS NULL)
    OR
    (bot_token_ciphertext IS NOT NULL AND bot_token_iv IS NOT NULL AND bot_token_auth_tag IS NOT NULL
      AND token_last4 IS NOT NULL AND char_length(token_last4) = 4)
  ),
  CONSTRAINT telegram_notification_settings_enabled_check CHECK (
    NOT enabled OR (chat_id IS NOT NULL AND char_length(btrim(chat_id)) BETWEEN 1 AND 32
      AND bot_token_ciphertext IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS order_notification_outbox (
  id                            BIGSERIAL PRIMARY KEY,
  order_id                      INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  event_key                     TEXT NOT NULL UNIQUE,
  event_type                    TEXT NOT NULL CHECK (event_type IN (
                                  'order_created', 'payment_paid', 'order_cancelled', 'fulfillment_changed')),
  payload                       JSONB NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count                 INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  status                        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  locked_at                     TIMESTAMPTZ,
  sent_at                       TIMESTAMPTZ,
  telegram_message_id           BIGINT,
  last_error                    TEXT,
  CONSTRAINT order_notification_outbox_state_check CHECK (
    (status = 'sent' AND sent_at IS NOT NULL AND telegram_message_id IS NOT NULL)
    OR (status IN ('pending', 'sending', 'failed') AND sent_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_order_notification_outbox_ready
  ON order_notification_outbox (available_at, id)
  WHERE status = 'pending';
```

`event_key` — явный ключ дедупликации: `order:<id>:created`,
`order:<id>:paid`, `order:<id>:cancelled`,
`order:<id>:fulfillment:<audit_event_id>`. Он не зависит от точности времени и
не даёт повторному callback или ретраю транзакции создать лишнее сообщение.
Вставка обязана выполняться только как
`INSERT … ON CONFLICT (event_key) DO NOTHING`: уже существующий event key —
успешный идемпотентный результат, а не ошибка, откатывающая заказ или платёж.

`payload` — snapshot, сформированный сервером в момент доменного события:
номер, суммы, позиции, причина/трек и время. Он не содержит персональных
данных или snapshot доставки. Очередь не перечитывает изменяемый каталог или
настройки доставки при отправке.

## 6. Секреты и безопасность

Токен бота не хранится в открытом виде ни в БД, ни в логах, ни в ответах API.

- Добавляется серверная переменная `TELEGRAM_SETTINGS_ENCRYPTION_KEY`: 32
  случайных байта в base64. Она хранится только в production `.env` и не
  коммитится. Формат валидируется при попытке сохранить или использовать
  Telegram-настройку.
- Перед записью токен шифруется AES-256-GCM (`randomBytes(12)` IV); в БД
  сохраняются ciphertext, IV и authentication tag. Ключ не попадает в backup
  БД. Потеря ключа означает, что токен нужно ввести заново.
- Токен расшифровывается только в серверном sender-е на время вызова Telegram
  `sendMessage`; очищенный DTO, React props, API-ответы и логи содержат лишь
  `configured: true` и `tokenLast4`.
- Все `/api/admin/settings/notifications/**` требуют `requireAdminApi()`, а
  изменяющие запросы — `assertSameOrigin()`. Ответы: `Cache-Control: private,
  no-store`.
- Токен валидируется сервером по формату `^\d{6,12}:[A-Za-z0-9_-]{20,}$`;
  `chatId` принимается строкой `^-?\d{1,20}$`. Не следует приводить chat ID к
  JS Number: отрицательные ID групп и большие значения должны сохраниться без
  потери точности.
- HTTP-клиент использует только `https://api.telegram.org`, timeout 10 секунд,
  без пользовательского URL и без редиректов. Тело/ответ Telegram с токеном не
  логируются.

## 7. Админский UI и API

В protected-nav добавляется ссылка «Уведомления»:

```text
/admin/settings/notifications
Telegram-уведомления о заказах

[ ] Включить уведомления
Токен бота              [••••••••••••]  «Не показывается после сохранения»
ID чата                 [-1001234567890]
Текущий токен: настроен (…9aQ2)
Последняя ошибка: … / «нет»
                               [Сохранить]

[Отключить и удалить токен]
```

- При первом включении токен и ID чата обязательны. При последующем сохранении
  пустой токен означает «сохранить прежний», а не удалить его.
- `enabled=false` прекращает новые отправки, но уже сохранённая очередь не
  удаляется. После повторного включения она может быть отправлена: UI прямо
  предупреждает об этом. Кнопка «Отключить и удалить токен» выключает канал и
  помечает ожидающие сообщения `failed` с причиной `credentials_removed`, чтобы
  они не ушли в другой чат после новой настройки.
- В UI нет кнопки «Отправить тест»: это сознательная граница текущего релиза.
  Ошибка настройки видна после первого реального события и в поле «Последняя
  ошибка».

| Метод и путь | Поведение |
| --- | --- |
| `GET /api/admin/settings/notifications` | Возвращает `{ enabled, chatId, configured, tokenLast4, updatedAt, lastDeliveryError, lastDeliveryErrorAt }`; токен никогда не возвращает. Если строки нет — безопасные значения по умолчанию. |
| `PATCH /api/admin/settings/notifications` | Принимает строго `{ enabled, chatId?, botToken? }`. Сохраняет токен только если он непустой; при `enabled:true` требует действующие credentials и encryption key. |
| `DELETE /api/admin/settings/notifications/credentials` | Requires confirm body `{ confirm: true }`; выключает канал, стирает зашифрованный токен и отменяет pending outbox, как описано выше. |

UI не должен показывать токен в DOM после сохранения, помещать его в URL,
localStorage, текст ошибки или `console`.

## 8. Создание событий и доставка

### 8.1. Атомарное создание

Data-layer, который меняет заказ, получает зависимость
`enqueueOrderNotification(tx, event)`. Она вставляет outbox в **ту же SQL-
транзакцию**, что и изменение заказа:

- `createOrder` → `order_created`;
- `markOrderPaid` при реальном `UPDATE … RETURNING` → `payment_paid`;
- `cancelAdminOrder` при `changed` → `order_cancelled`;
- `transitionFulfillment` после добавления audit-события → `fulfillment_changed`
  с ID этого audit-события в `event_key`.

Перед вставкой `enqueueOrderNotification` вызывает
`readNotificationSnapshot(client, orderId)`: та же transaction connection читает
строку `orders` и все `order_items`. Вызов происходит после успешного изменения
статуса (и после audit insert для исполнения), но до commit. Нельзя
переиспользовать `getAdminOrderById()`: он использует глобальный query-layer и
не гарантирует тот же transaction snapshot. В payload попадают только
разрешённые §4 обезличенные поля.

Вставка имеет точную форму:

```sql
INSERT INTO order_notification_outbox (order_id, event_key, event_type, payload)
VALUES ($1, $2, $3, $4::jsonb)
ON CONFLICT (event_key) DO NOTHING;
```

Если заказная транзакция откатилась, outbox тоже не появляется. Если она
закоммитилась, событие существует независимо от того, доступен ли Telegram.
`already_paid`, конфликтные и невалидные переходы enqueue не вызывают.

### 8.2. Sender

Добавляется `lib/telegram-notifications.ts` с чистыми функциями формирования
текста и серверным sender-ом. Route handler **не** запускает доставку и не ждёт
Telegram: он отвечает сразу после commit заказа и outbox. Надёжность обеспечивает
отдельный TypeScript runner:

```text
npm run notifications:drain
```

В `dependencies` (не `devDependencies`) добавляется `tsx`, а в `package.json`:

```json
"notifications:drain": "tsx scripts/drain-notifications.ts"
```

`tsx` читает `tsconfig.json` и поддерживает импорт `@/*`, поэтому runner может
переиспользовать server-only `lib/telegram-notifications.ts` и `lib/db.ts`.
На production systemd timer раз в минуту вызывает эту npm-команду; unit и
service timer добавляются в `docs/operations.md`. Один запуск берёт пачку строк
через `FOR UPDATE SKIP LOCKED`, чтобы два процесса не отправляли одну строку
одновременно. Зависшие `sending` старше 15 минут возвращаются в `pending` при
следующем drain.

Для каждой строки sender:

1. перечитывает актуальную настройку; если канал выключен — оставляет `pending`;
2. расшифровывает токен и вызывает Telegram Bot API `sendMessage` с
   `{ chat_id, text, disable_web_page_preview: true }`;
3. при `ok: true` пишет `sent`, `sent_at`, `telegram_message_id`;
4. при сетевой ошибке/5xx/429 возвращает `pending` с backoff 1, 5, 15, 60 минут,
   затем раз в 6 часов, максимум 10 попыток;
5. при 400/403 помечает конкретное сообщение `failed` и сохраняет безопасное
   описание ошибки, но не отключает канал: бот мог быть временно исключён из
   чата или chat ID мог быть исправлен до следующего события;
6. при 401 помечает сообщение `failed` и отключает канал: токен неверен или
   отозван, поэтому дальнейшие попытки бессмысленны.

После 10 неудач строка получает `failed`; статус и последняя ошибка видны в
админке. Повторная отправка вручную в этом релизе не предусмотрена.

Ограничение в 10 секунд относится только к одному HTTP-вызову Telegram
`sendMessage`; это не таймаут route handler и не ограничение времени drain.

Семантика доставки — *at-least-once*: при обрыве сети после того, как Telegram
уже принял сообщение, но до записи `sent`, возможен один повтор. Смена статуса
заказа от этого не повторяется и не зависит от Telegram. Telegram Bot API не
даёт idempotency key, поэтому обещать строго «ровно один раз» нельзя.

## 9. Изменения файлов

| Область | Изменение |
| --- | --- |
| `shop/sql/migrations/004_telegram_order_notifications.sql` | Настройки, durable outbox, индексы и event key. |
| `shop/lib/telegram-settings.ts` | DTO без токена, валидация, AES-GCM, CRUD настроек. |
| `shop/lib/telegram-notifications.ts` | Типы событий, transaction-safe `readNotificationSnapshot`, форматтер, idempotent enqueue, Telegram sender, drain/backoff. |
| `shop/lib/orders.ts` | Enqueue в транзакциях создания и подтверждения оплаты. |
| `shop/lib/admin-orders-db.ts` | Enqueue в транзакциях отмены и переходов исполнения. |
| `shop/app/api/admin/settings/notifications/route.ts` | Защищённые GET/PATCH/DELETE API. |
| `shop/app/admin/(protected)/settings/notifications/page.tsx` и форма | Экран настройки без показа токена. |
| `shop/app/admin/(protected)/layout.tsx` | Ссылка «Уведомления». |
| `shop/scripts/drain-notifications.ts`, `package.json` | Runner и `notifications:drain`; `tsx` добавляется в production `dependencies`. |
| `.env.example`, `docs/operations.md` | Переменная ключа и production systemd timer. |

## 10. Проверка

Юнит- и mock-интеграционные тесты обязательны до rollout:

1. AES-GCM: токен round-trip; GET/API/лог не раскрывают исходный токен;
   некорректный ключ и tag безопасно завершаются ошибкой.
2. Валидация token/chat ID, запрет включения без credentials и без encryption
   key; пустой token при PATCH сохраняет прежний.
3. Каждый допустимый доменный переход создаёт ровно один соответствующий
   `event_key`; повтор ResultURL и `409` не создают outbox.
4. Transactional test: при rollback заказа outbox отсутствует.
5. Форматтер: нет HTML/Markdown-инъекции, персональные данные, email и
   платёжные секреты отсутствуют; сумма/позиции/причина/трек корректны.
6. Sender: `ok:true → sent`; 429/5xx планируют retry; 400/403 создают
   `failed` без выключения канала, 401 выключает канал; две конкурирующие
   задачи не берут одну строку.
7. Админ API: 401 без сессии, 403 на чужой Origin, `Cache-Control: no-store`,
   token не возвращается и не записывается в client HTML.

Production smoke-test после миграции: сохранить настройки в отдельный тестовый
чат, оформить тестовый заказ, подтвердить тестовый платёж и один переход
исполнения; проверить по БД `pending → sent`, а в Telegram — три сообщения.
Только после этого разрешать настройку рабочего чата.

## 11. Критерии готовности

- Админ может задать bot token и chat ID, увидеть лишь маску токена, выключить
  канал и удалить credentials.
- Для нового заказа и каждой реальной смены статуса создаётся один outbox-event.
- Секрет не покидает сервер и не попадает в backups в открытом виде.
- Недоступный Telegram не ломает checkout, ResultURL и админские переходы;
  сообщение либо доставляется позднее, либо имеет понятный `failed`-статус.
- Бот не принимает входящие сообщения и не обладает возможностью менять данные
  магазина.
