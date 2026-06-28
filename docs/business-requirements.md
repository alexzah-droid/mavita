# Бизнес-требования и функции — МАВИТА-ШОП

Дата актуализации: 2026-06-28

Назначение документа: единый каталог бизнес-требований и функций интернет-магазина
свечей МАВИТА. Служит основой для **трассировки** (требование → код → тест) и
**справки/инструкции** для владельца и команды.

Как читать: у каждого требования есть стабильный идентификатор (`BR-*` — бизнес-правило,
`FR-*` — функция). На них ссылаются тесты и спецификации. Технические инварианты
(`I1…I10`) определены в [PROJECT_CORE.md](../PROJECT_CORE.md) §5 — здесь на них только ссылки.

Источники: [PROJECT_CORE.md](../PROJECT_CORE.md), [architecture.md](../architecture.md),
[ROADMAP.md](../ROADMAP.md), `shop/sql/schema.sql`, `shop/lib/*`, `shop/app/*`,
спецификации в [docs/specs/](specs/).

---

## 1. Контекст и цель бизнеса

| Аспект | Описание |
| --- | --- |
| Продукт | Интернет-магазин авторских свечей под брендом МАВИТА (`mavita.ru`) |
| Цель | Продавать свечи онлайн: витрина → корзина → оплата → исполнение заказа |
| Владелец | Самозанятый (Захарова В.Б.), приём платежей через Робокассу, 54-ФЗ через агрегатор |
| Масштаб | Малый каталог (единицы–десятки SKU), один администратор, один VPS |
| Платёж | Робокасса (онлайн-эквайринг), подпись MD5/SHA на сервере |
| Доставка | СДЭК до пункта выдачи (ПВЗ); доступность checkout зависит от серверных настроек перевозчика и аварийного флага `DELIVERY_ENABLED` |

Полное описание бренда, ЦА и тона — [brand.md](../brand.md).

---

## 2. Роли (актёры)

| Роль | Доступ | Назначение |
| --- | --- | --- |
| **Покупатель** | Публичная витрина, без регистрации | Смотрит каталог, собирает корзину, оформляет и оплачивает заказ, отслеживает его по ссылке |
| **Администратор** | `/admin/**` за паролем (iron-session) | Управляет товарами, фото, витриной, скидками, заказами, доставкой, уведомлениями |
| **Робокасса** (система) | Сервер→сервер `/api/robokassa/result` | Подтверждает факт оплаты |
| **СДЭК** (система) | `/api/cdek`, `/api/cdek/cities`, `/api/cdek/widget`, `/api/cdek/webhook` | Поиск городов и ПВЗ, прокси для виджета, автоотправка и получение статусов |
| **Telegram** (система) | Исходящие уведомления | Доставляет администратору уведомления о событиях заказа |

Регистрации/личных кабинетов покупателей нет — заказ адресуется неугадываемым `token`.

---

## 3. Функции — публичная витрина

### 3.1 Каталог и карточка товара

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-CAT-1 | Витрина показывает список товаров | Только `visibility = public`, сортировка по `sort_order, id` | `app/page.tsx`, `lib/catalog.ts` |
| FR-CAT-2 | Карточка товара по slug | URL `/product/<slug>`; `public` и `unlisted` доступны по прямой ссылке, `hidden` — нет | `app/product/[slug]/page.tsx` |
| FR-CAT-3 | Галерея фото товара | Несколько фото, обложка (`is_cover`) — главная на витрине | `app/components/ProductGallery.tsx`, `product_images` |
| FR-CAT-4 | Отображение цены и скидки | Эффективная цена и зачёркнутая регулярная при активной скидке | `app/components/PriceDisplay.tsx`, `lib/pricing.ts` |
| FR-CAT-5 | Признак наличия | `in_stock=false` — товар виден, но не покупается | `lib/catalog.ts` |
| FR-CAT-6 | Атрибуты товара | Серия, подзаголовок, описание, ароматы (`scent[]`) | `products` |
| FR-CAT-7 | Фоллбэк без БД | Без `DATABASE_URL` — seed-каталог; БД настроена, но недоступна → `503`, не seed | `lib/catalog.ts` |

### 3.2 Корзина

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-CART-1 | Добавление в корзину | С витрины и из карточки | `app/cart/AddToCartButton.tsx` |
| FR-CART-2 | Хранение корзины | `localStorage` на клиенте, React Context | `app/cart/CartProvider.tsx` |
| FR-CART-3 | Изменение количества / удаление | Кол-во ≥ 1, ограничение `MAX_QTY = 99` на позицию | `lib/cart.ts`, `app/cart/page.tsx` |
| FR-CART-4 | Счётчик и итог | Счётчик в шапке, промежуточный итог корзины | `app/cart/CartButton.tsx`, `lib/cart.ts` |

> Корзина — клиентская и не авторитетна по цене. Итог при оплате пересчитывается на сервере (BR-MONEY-2).

### 3.3 Оформление заказа (checkout)

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-CHK-1 | Форма получателя | ФИО, email, телефон — обязательны и валидируются | `app/checkout/page.tsx`, `lib/orders.ts` |
| FR-CHK-2 | Валидация контактов | Email по regex; телефон нормализуется к `+7XXXXXXXXXX` (11 цифр, начинается 7/8) | `validateOrderInput`, `normalizePhone` |
| FR-CHK-3 | Выбор ПВЗ СДЭК | Обязателен в режиме `pickup_required`; при `disabled` checkout оформляет заказ без ПВЗ, при `error` checkout недоступен (`503`) | `app/api/checkout/delivery/route.ts`, `lib/store-settings.ts`, `lib/orders.ts` |
| FR-CHK-4 | Создание заказа | Заказ создаётся `status=pending`, `fulfillment=awaiting_payment` | `createOrder` |
| FR-CHK-5 | Защита от подмены цены | Цена/название позиций берутся из БД (snapshot), не от клиента (I9) | `buildOrderLines`, `fetchCatalog` |
| FR-CHK-6 | Сверка ожидаемой суммы | Клиентские `expectedTotalKopecks`/`expectedDeliveryKopecks` сверяются с серверным расчётом → `PriceChangedError` при расхождении | `createOrder` |
| FR-CHK-7 | Схлопывание дублей | Повтор одного slug суммируется в одну позицию (TD-10) | `buildOrderLines` |

### 3.4 Оплата (Робокасса)

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-PAY-1 | Инициация оплаты | `POST /api/robokassa/init`: пересчёт сумм, создание `pending`, подпись `MD5(Login:OutSum:InvId:Password1)`, редирект в Робокассу | `app/api/robokassa/init/route.ts`, `lib/robokassa.ts` |
| FR-PAY-2 | Подтверждение оплаты (ResultURL) | `/api/robokassa/result`: проверка `MD5(OutSum:InvId:Password2)`, сверка суммы, `pending→paid`, ответ `OK{InvId}` (I3) | `app/api/robokassa/result/route.ts`, `markOrderPaid` |
| FR-PAY-3 | Идемпотентность колбэка | Повтор по оплаченному → `already_paid`; гонка двух колбэков → ровно один `paid` (по `RETURNING`, TD-18) | `markOrderPaid` |
| FR-PAY-4 | Защита от недоплаты | Сумма от Робокассы ≠ `total_kopecks` → `amount_mismatch`, статус не меняется (TD-4) | `markOrderPaid` |
| FR-PAY-5 | Оплата отменённого заказа | `cancelled` + оплата → `cancelled` (нужен ручной разбор, не теряем ретраи Робокассы, TD-17) | `markOrderPaid` |
| FR-PAY-6 | Возврат покупателя | `/success` и `/fail` редиректят на `/order/<token>`; статус «оплачено» — из БД, не из query (TD-2) | `success/route.ts`, `fail/route.ts` |
| FR-PAY-7 | Тестовый режим | `ROBOKASSA_TEST_MODE`; в тест-режиме Робокасса шлёт GET — handler принимает GET и POST | `result/route.ts` |
| FR-PAY-8 | Hardening колбэка | Настраиваемый алгоритм подписи (TD-20), опциональный allowlist IP `/result` (TD-19) | `lib/robokassa.ts`, `.env.example` |

### 3.5 Отслеживание заказа

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-ORD-1 | Страница заказа | `/order/<token>` — состав, суммы, статус оплаты по неугадываемому token (защита от IDOR, TD-1) | `app/order/[token]/page.tsx`, `getOrderByToken` |

### 3.6 Статические/правовые страницы

| ID | Функция | Код |
| --- | --- | --- |
| FR-PAGE-1 | Оферта | `app/offer/page.tsx` |
| FR-PAGE-2 | Политика конфиденциальности | `app/privacy/page.tsx` |
| FR-PAGE-3 | Доставка | `app/delivery/page.tsx` — публичная страница с описанием доставки через ПВЗ СДЭК |

### 3.7 Technical SEO

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-SEO-1 | Базовый technical SEO | Есть `robots.txt`, `sitemap.xml`, canonical/Open Graph/Twitter metadata на ключевых публичных страницах, JSON-LD `Organization` на витрине и `Product` на карточке; служебные страницы (`/admin`, `/cart`, `/checkout`, `/order/<token>`) закрыты от индексации | `app/robots.ts`, `app/sitemap.ts`, `lib/seo.ts`, `app/layout.tsx`, `app/page.tsx`, `app/product/[slug]/page.tsx`, `app/{admin,cart,checkout}/layout.tsx`, `app/order/[token]/page.tsx` |

---

## 4. Функции — администрирование

### 4.1 Аутентификация и доступ

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-AUTH-1 | Вход по паролю | Без логина, только пароль; `ADMIN_PASSWORD` в `.env`; сравнение `timingSafeEqual` SHA-256 (I8) | `lib/auth.ts`, `app/api/auth/login` |
| FR-AUTH-2 | Сессия | iron-session (шифрованная cookie), `SESSION_SECRET` | `lib/auth.ts` |
| FR-AUTH-3 | Rate-limit входа | Ограничение попыток; доверенный IP из `X-Forwarded-For` за Nginx | `lib/auth.ts` |
| FR-AUTH-4 | Гард страниц и API | `requireAdminPage()` / `requireAdminApi()` на всех `/admin/**`, `/api/admin/**`, `/api/upload` (кроме login/logout) (I8) | `app/admin/(protected)/layout.tsx`, route-handlers |
| FR-AUTH-5 | Same-origin для мутаций | Сверка хоста `Origin` с `Host` (не полный origin — за прокси `request.url`=http) (I8, TD-22) | `assertSameOrigin` |
| FR-AUTH-6 | Логаут | `/api/auth/logout` | `app/api/auth/logout/route.ts` |

### 4.2 Управление товарами и витриной

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-PROD-1 | Список товаров | Все товары независимо от видимости | `app/admin/(protected)/page.tsx`, `AdminProductsList.tsx` |
| FR-PROD-2 | Создать товар | Название, slug, серия, подзаголовок, описание, цена, ароматы, наличие | `app/admin/products/new`, `AdminProductForm.tsx` |
| FR-PROD-3 | Редактировать товар | Те же поля; `updated_at` обновляется триггером БД | `app/admin/products/[id]/edit`, `lib/admin-products-db.ts` |
| FR-PROD-4 | Управление видимостью | `public` / `unlisted` / `hidden` | `products.visibility` |
| FR-PROD-5 | Сортировка drag-and-drop | Перетаскивание меняет `sort_order` | `POST /api/admin/products/reorder` |
| FR-PROD-6 | Скидка по таймеру | `sale_price_kopecks` + окно `sale_starts_at`/`sale_ends_at`; цена скидки < обычной (CHECK) | `lib/pricing.ts`, `products` |

### 4.3 Управление фотографиями

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-IMG-1 | Загрузка фото | Только admin `POST /api/upload`; файл + `product_images` компенсируемо-атомарно (I5) | `app/api/upload/route.ts`, `lib/upload-image.ts` |
| FR-IMG-2 | Несколько фото на товар | Хранятся в `/public/uploads/products/`, Nginx отдаёт напрямую | `product_images` |
| FR-IMG-3 | Выбор обложки | Не более одной обложки на товар (partial unique index, TD-23) | `uq_product_cover` |
| FR-IMG-4 | Распознавание формата | Принимается стандартный WebP (TD-24) | `app/api/admin/products/[id]/images/route.ts` |
| FR-IMG-5 | Удаление фото | Удаление записи и файла | `images/[imageId]/route.ts` |

### 4.4 Управление заказами и исполнением

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-ADMORD-1 | Список заказов | Фильтры: статус, период (`dateFrom/dateTo`), поиск (id/телефон/имя/email); пагинация курсором | `app/admin/orders`, `lib/admin-orders-db.ts` |
| FR-ADMORD-2 | Маскирование PII в списке | Телефон маскируется в списке (`maskPhone`) | `lib/admin-orders.ts` |
| FR-ADMORD-3 | Карточка заказа | Состав, суммы (товары/доставка/итог), ПВЗ-snapshot, трек, история событий, данные по отправлению СДЭК | `app/admin/orders/[id]`, `getAdminOrderById`, `AdminOrderCdek.tsx` |
| FR-ADMORD-4 | Отмена заказа | Только `pending` → `cancelled`; обязательна причина 5–500 симв.; пишется аудит-событие | `cancelAdminOrder`, `POST .../cancel` |
| FR-ADMORD-5 | Переходы исполнения | `new→packing→handed_to_carrier→delivered`; передача перевозчику требует трек 5–64 симв. | `transitionFulfillment`, `POST .../fulfillment` |
| FR-ADMORD-6 | Запрет ручного `paid` | Ни один шаг отгрузки не ставит `paid`; платёжный и исполнительский статусы разделены (I10) | `transitionFulfillment` (требует `status=paid`) |
| FR-ADMORD-7 | Неизменяемый аудит | Все отмены, переходы исполнения и обновления статусов СДЭК пишутся в `order_admin_events` с актёром и временем | `order_admin_events` |

### 4.5 Настройки

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-SET-1 | Настройки перевозчика СДЭК | Включение/выключение, `clientId`, секрет, фиксированный тариф до ПВЗ; `0` — явная бесплатная доставка; при неполной конфигурации включение запрещено | `app/admin/settings/delivery`, `app/api/admin/settings/delivery`, `store_settings` |
| FR-SET-2 | Автосоздание накладных СДЭК | Настройка точки сдачи, отправителя, дефолтных веса/габаритов, регистрация вебхука СДЭК | `app/admin/CdekShipmentSettingsForm.tsx`, `app/api/admin/settings/cdek-shipment`, `lib/cdek-shipment.ts` |
| FR-SET-3 | Telegram-уведомления | Включение, `chat_id`, токен бота; токен хранится **только зашифрованным** (AES-GCM) | `app/admin/settings/notifications`, `lib/telegram-settings.ts` |

### 4.6 Уведомления администратора (Telegram)

| ID | Функция | Правила | Код |
| --- | --- | --- | --- |
| FR-NOTE-1 | События заказа | Уведомления о `order_created`, `payment_paid`, `order_cancelled`, `fulfillment_changed` | `lib/telegram-notifications.ts` |
| FR-NOTE-2 | Транзакционная постановка | Событие кладётся в `order_notification_outbox` в той же транзакции, что и изменение заказа; ключ идемпотентен (`event_key UNIQUE`) | `enqueueOrderNotification` |
| FR-NOTE-3 | Надёжная доставка | Outbox-воркер с блокировкой (`FOR UPDATE SKIP LOCKED`), ретраи с backoff (1/5/15/60/360 мин), фиксация ошибок | `claimNext`, `sendClaimed`, `retryMinutes` |
| FR-NOTE-4 | Содержимое сообщения | № заказа, статус, сумма, позиции, время (МСК), причина/трек, ссылка в админку | `formatTelegramOrderNotification` |
| FR-NOTE-5 | Шифрование токена | `TELEGRAM_SETTINGS_ENCRYPTION_KEY`; в БД только ciphertext+iv+tag и `token_last4` | `telegram_notification_settings` |

---

## 5. Бизнес-правила (сквозные)

### 5.1 Деньги

| ID | Правило | Инвариант |
| --- | --- | --- |
| BR-MONEY-1 | Все цены и суммы — в **копейках**, `INTEGER`. FLOAT запрещён | I2 |
| BR-MONEY-2 | Итоговая сумма заказа считается **только на сервере**: `total = items + delivery`; клиент цену не задаёт | I10 |
| BR-MONEY-3 | Цена позиции — `effectivePrice()` по срезу БД, заблокированному в транзакции в момент создания заказа | I9 |
| BR-MONEY-4 | Инвариант суммы в БД: `total_kopecks = items_kopecks + delivery_kopecks` (CHECK) | — |
| BR-MONEY-5 | Подпись Робокассы считается **только** на сервере; Password1/Password2 — только в `.env` | I1 |

### 5.2 Скидки

| ID | Правило |
| --- | --- |
| BR-SALE-1 | Скидка активна, только если задана цена скидки < обычной и текущий момент в окне `[starts, ends)` |
| BR-SALE-2 | Некорректное окно (ends ≤ starts) или невалидные даты — скидка игнорируется, действует обычная цена |
| BR-SALE-3 | Скидочная цена фиксируется в snapshot заказа на момент покупки (BR-MONEY-3) |

### 5.3 Статусы заказа

Платёжный статус (`status`) и статус исполнения (`fulfillment_status`) разделены и
связаны CHECK-ограничениями в БД.

```
ПЛАТЁЖНЫЙ:   pending ──Робокасса──▶ paid
                 │
                 └──admin cancel──▶ cancelled

ИСПОЛНЕНИЕ:  awaiting_payment ──оплата──▶ new ──▶ packing ──▶ handed_to_carrier ──▶ delivered
                 │
                 └──admin cancel──▶ cancelled
```

| ID | Правило |
| --- | --- |
| BR-STATUS-1 | `pending` ⇔ `awaiting_payment`; `paid` ⇔ `{new,packing,handed_to_carrier,delivered}`; `cancelled` ⇔ `cancelled` (CHECK) |
| BR-STATUS-2 | Статус меняется **только через API**, не прямым `UPDATE` (I4) |
| BR-STATUS-3 | Переход исполнения возможен только при `status=paid` и только на следующий шаг |
| BR-STATUS-4 | `tracking_number` обязателен в `handed_to_carrier`/`delivered`, иначе должен быть NULL (CHECK) |
| BR-STATUS-5 | Отмена возможна только из `pending` (неоплаченный заказ) |

### 5.4 Доставка

| ID | Правило |
| --- | --- |
| BR-DELIV-1 | Режим доставки вычисляется сервером через `resolveDeliveryMode()`: `disabled`, `pickup_required` или `error` |
| BR-DELIV-2 | `DELIVERY_ENABLED=false` — аварийный global off: checkout оформляет заказ без ПВЗ, `delivery_method/carrier=NULL`, `delivery_kopecks=0`, `total=items` |
| BR-DELIV-3 | В режиме `pickup_required` ПВЗ обязателен; snapshot ПВЗ берётся повторно на сервере через CDEK API, клиентский callback не авторитетен |
| BR-DELIV-4 | Включённый, но неполно настроенный СДЭК не деградирует в заказ без доставки: checkout возвращает `503` (`mode=error`) |
| BR-DELIV-5 | Snapshot ПВЗ полон или отсутствует целиком: code/city/name/address либо все заданы, либо `delivery_method=NULL` (CHECK) |
| BR-DELIV-6 | Единственный поддерживаемый метод — `cdek_pickup` / перевозчик `cdek` (CHECK); схема нейтральна для будущих перевозчиков |

### 5.5 Безопасность и приватность

| ID | Правило |
| --- | --- |
| BR-SEC-1 | Заказ адресуется неугадываемым `token`, не серийным id (анти-IDOR) |
| BR-SEC-2 | Все админ-эндпоинты за гардом + same-origin на мутациях (I8) |
| BR-SEC-3 | Инфраструктурные секреты хранятся в `.env`; секреты интеграций, редактируемые из админки (СДЭК, Telegram), хранятся в БД только в зашифрованном виде |
| BR-SEC-4 | Telegram-токен — только в зашифрованном виде в БД |
| BR-SEC-5 | `index.html` (КП-бандл) не редактируется вручную (I6) |

---

## 6. Сущности данных

Канонический DDL — `shop/sql/schema.sql`. Сводка для трассировки:

| Сущность | Назначение | Ключевые поля/инварианты |
| --- | --- | --- |
| `products` | Товары | `price_kopecks`, `visibility`, окно скидки, `scent[]`, `sort_order`, `updated_at` (триггер) |
| `product_images` | Фото товара | `is_cover` (≤1 на товар), `sort_order` |
| `orders` | Заказы | `token`, `inv_id`, `status`+`fulfillment_status`, суммы, ПВЗ-snapshot, `tracking_number`, `robokassa_data` |
| `order_items` | Состав заказа | snapshot `product_name` и `price_kopecks`, `quantity` |
| `store_settings` | Настройки магазина (singleton) | включение СДЭК, тариф, зашифрованные credentials, настройки автоотправки, webhook UUID |
| `order_admin_events` | Аудит админ-действий и статусов доставки | `cancelled` / `fulfillment_transition` / `cdek_status_update`, актёр, время (неизменяемый) |
| `telegram_notification_settings` | Настройки уведомлений (singleton) | зашифрованный токен, `chat_id`, `enabled` |
| `order_notification_outbox` | Очередь уведомлений | `event_key UNIQUE`, статус, ретраи, `telegram_message_id` |
| `cdek_task_outbox` | Очередь задач автоотправки СДЭК | `pending/processing/done/failed`, ретраи, ошибка последней попытки |

---

## 7. Внешние интеграции

| Система | Направление | Эндпоинт/модуль | Назначение |
| --- | --- | --- | --- |
| Робокасса | покупатель→РК, РК→сервер | `/api/robokassa/{init,result,success,fail}`, `lib/robokassa.ts` | Приём онлайн-оплаты, подтверждение по подписи |
| СДЭК | сервер→СДЭК (OAuth) | `/api/cdek`, `/api/cdek/cities`, `/api/cdek/widget`, `lib/cdek.ts`, `lib/cdek-shipment.ts` | Поиск городов и ПВЗ, повторная проверка выбранного ПВЗ, виджет checkout, создание/аннулирование отправлений и получение PDF/штрихкода |
| Telegram Bot API | сервер→Telegram | `lib/telegram-notifications.ts` | Уведомления администратору о событиях заказа |

Спецификации интеграций: [docs/specs/done/cdek-pvz.md](specs/done/cdek-pvz.md),
[docs/specs/done/order-telegram-notifications.md](specs/done/order-telegram-notifications.md).

---

## 8. Текущее состояние и границы (rollout)

| Область | Состояние |
| --- | --- |
| Витрина, корзина, checkout, оплата | ✅ реализованы и работают (Ф0–Ф3) |
| Админка: товары/фото/видимость/скидки | ✅ на проде (Ф4-К1) |
| Админка: заказы/исполнение/аудит/настройки | ✅ реализованы, включая настройки доставки и карточку заказа с данными СДЭК |
| Telegram-уведомления | ✅ в репозитории |
| Доставка СДЭК | ✅ интегрирована: checkout использует серверный режим доставки, поиск ПВЗ и виджет; доступность зависит от настроек перевозчика |
| Автоотправка СДЭК | ✅ реализована: outbox-задачи, создание/аннулирование отправлений, webhook статусов, обновление PDF-накладной/штрихкода |
| Робокасса боевой режим | согласно `docs/environments.md`; переключение `ROBOKASSA_TEST_MODE=false` — Пауза 1 |
| Страница «Доставка» | ✅ соответствует текущему сценарию с ПВЗ СДЭК |

**Вне области (out of scope) текущей версии:** регистрация/ЛК покупателей, категории
товаров, несколько перевозчиков, автоматический деплой (CI/CD), возвраты/частичная
оплата, складской учёт. Горизонты роста — [architecture.md](../architecture.md) §«Масштабирование».

---

## 9. Трассировка

Связь требований с тестами ведётся в [TESTING_PLAN.md](../TESTING_PLAN.md) (по инвариантам)
и в `*.test.ts` рядом с модулями. Этот документ — реестр требований; при добавлении
функции добавляется новый `FR-*`/`BR-*` и ссылка на код и тест.

| Слой | Где |
| --- | --- |
| Требования | этот файл (`FR-*`, `BR-*`) |
| Инварианты | [PROJECT_CORE.md](../PROJECT_CORE.md) §5 (`I1…I10`) |
| Тесты | `shop/lib/*.test.ts`, `shop/app/**/*.test.ts`, `shop/e2e/` |
| Техдолг/решения | [docs/tech-debt.md](tech-debt.md), [docs/decisions.md](decisions.md) |
| Спецификации | [docs/specs/](specs/) и [docs/specs/done/](specs/done/) |
