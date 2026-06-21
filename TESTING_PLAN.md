# TESTING_PLAN — МАВИТА-ШОП

Дата актуализации: 2026-06-21

Трассировка тестов по инвариантам и по требованиям. Каждый инвариант из
`PROJECT_CORE.md` должен получить тест до перехода в следующую фазу; требования
`FR-*`/`BR-*` из [docs/business-requirements.md](docs/business-requirements.md)
связываются с тестами в §«Требования → тесты».

## Статус

> 141 тест в 32 файлах зелёные (`npm test`, 2026-06-21). Покрыты Ф0–Ф3,
> оба компонента Ф4; `npm run typecheck` также проходит.
> I5/I8/I9/I10 покрыты unit/mock-интеграционными тестами. Прогон с реальной
> PostgreSQL/ФС, CDEK и Робокассой остаётся отдельной проверкой стенда.

Telegram-уведомления: покрыты AES-GCM round-trip и битый tag, валидация
credentials, формат обезличенного сообщения, лимит retry, transaction snapshot
и `ON CONFLICT`, защищённый settings API и контракт миграции `004`.
Live-прогон PostgreSQL `SKIP LOCKED` и реальных ответов Telegram (429/5xx/401/403)
остаётся обязательным перед production rollout.

## Инварианты → тесты

| ID | Инвариант | Тип теста | Файл | Статус |
| --- | --- | --- | --- | --- |
| I1 | Подпись только на сервере, Password в .env | unit | `lib/robokassa.test.ts` | ✅ написан |
| I2 | Цены в копейках (INTEGER) | unit + schema | `sql/schema.sql` + `lib/price.test.ts` | ✅ написан |
| I3 | result URL проверяет подпись перед обновлением | интеграционный | `app/api/robokassa/result.test.ts` | ✅ написан |
| I4 | Статус меняется только через API (+ сверка суммы и audit ручной отмены) | unit + mock-интеграционный | `app/api/robokassa/result.test.ts`, `lib/admin-orders-db.test.ts`, `app/api/admin/orders/**/*.test.ts` | ✅ покрыто; PostgreSQL-гард и гонка cancel/result требуют live-прогона |
| I5 | Фото: файл + product_images атомарно | unit + интеграционный | `app/api/upload/route.test.ts`, `app/api/admin/products/[id]/images/route.test.ts`, `lib/upload-image.ts` (через upload-тест) | guards + распознавание формата (JPEG/PNG/WebP VP8/VP8L/VP8X) + cover-инвариант (TD-23) покрыты юнитами; нужен прогон с тестовой PostgreSQL/ФС |
| I6 | index.html не в .gitignore, не редактируется | structural | `—` | ручная проверка |
| I7 | .env не коммитится | structural | `.gitignore` | ручная проверка |
| I8 | Гард admin/upload, session, CSRF | unit + интеграционный | `lib/auth.test.ts`, `app/api/auth/*.test.ts`, `app/api/admin/**/*.test.ts` | unit покрыт; требуется интеграционный прогон с БД |
| I9 | Серверная effective price в транзакционном snapshot заказа | unit + интеграционный | `lib/pricing.test.ts`, `lib/orders.test.ts` | unit покрыт; требуется интеграционный тест блокировок в PostgreSQL |
| I10 | Доставка серверно рассчитана и входит в snapshot полной суммы; исполнение не подменяет оплату | unit + mock-интеграционный | `lib/orders.test.ts`, `lib/admin-orders.test.ts`, `lib/admin-orders-db.test.ts`, `app/api/robokassa/init.test.ts`, `app/api/admin/settings/delivery/route.test.ts`, `sql/migrations/003_orders_delivery_and_admin_events.test.ts` | ✅ покрыто в репозитории; live PostgreSQL/CDEK-прогон открыт |

## Требования → тесты

Связь функций/правил из [docs/business-requirements.md](docs/business-requirements.md)
с тестами. Колонка «Инв.» — связанный инвариант. Легенда статуса: ✅ покрыто юнитами ·
🟡 частично/нужен live-прогон · ⬜ нет автотеста (ручная/UI-проверка).

### Витрина

| Требование | Инв. | Тест | Статус |
| --- | --- | --- | --- |
| FR-CAT-1/2/5/7 каталог, видимость, наличие, фоллбэк | I9 | `lib/catalog.test.ts`, `lib/products.test.ts`, `app/api/products.test.ts` | ✅ |
| FR-CAT-2 URL по slug | — | `lib/slug.test.ts`, `lib/product-url.test.ts` | ✅ |
| FR-CAT-4 эффективная цена/скидка на витрине | I2 | `lib/pricing.test.ts`, `lib/price.test.ts` | ✅ |
| FR-CAT-3/6 галерея, атрибуты, ароматы | — | — (UI) | ⬜ |
| FR-CART-1…4 корзина, количество, итог | — | `lib/cart.test.ts` | ✅ |
| FR-CHK-1/2 валидация формы и контактов | — | `lib/orders.test.ts` | ✅ |
| FR-CHK-4/5/7 создание заказа, snapshot цены, дубли | I9 | `lib/orders.test.ts` | ✅ (live PostgreSQL открыт) |
| FR-CHK-3/6 ПВЗ-режим и сверка сумм | I10 | `lib/orders.test.ts`, `lib/checkout-amounts.test.ts`, `app/api/robokassa/init/route.test.ts` | 🟡 |
| FR-PAY-1 init: подпись + редирект | I1 | `lib/robokassa.test.ts`, `app/api/robokassa/init/route.test.ts` | ✅ |
| FR-PAY-2 result: проверка подписи → paid | I3 | `app/api/robokassa/result.test.ts` | ✅ |
| FR-PAY-3/4/5 идемпотентность, недоплата, отменённый | I4 | `lib/orders.markPaid.test.ts`, `app/api/robokassa/result.test.ts` | 🟡 (гонка — live) |
| FR-PAY-6/7/8 success/fail, тест-режим, hardening | I1, I3 | `lib/robokassa.test.ts`, `app/api/robokassa/result.test.ts` | ✅ |
| FR-ORD-1 заказ по token | BR-SEC-1 | `lib/orders.test.ts` | 🟡 (live PostgreSQL) |
| FR-PAGE-1/2/3 правовые страницы | — | — (UI/контент) | ⬜ |

### Администрирование

| Требование | Инв. | Тест | Статус |
| --- | --- | --- | --- |
| FR-AUTH-1…6 вход, сессия, rate-limit, гард, CSRF | I8 | `lib/auth.test.ts`, `app/api/auth/login/route.test.ts`, `app/api/admin/**/*.test.ts` | 🟡 (интеграция с БД) |
| FR-PROD-1…5 CRUD товаров, видимость, сортировка | I8 | `lib/products-admin.test.ts`, `app/api/admin/products/route.test.ts` | ✅ |
| FR-PROD-6 скидка по таймеру | I2, I9 | `lib/pricing.test.ts` | ✅ |
| FR-IMG-1…5 загрузка/обложка/формат/удаление | I5 | `app/api/upload/route.test.ts`, `app/api/admin/products/[id]/images/route.test.ts` | 🟡 (live ФС/PostgreSQL) |
| FR-ADMORD-1/2/3 список, маска PII, карточка | — | `lib/admin-orders.test.ts`, `lib/admin-orders-db.test.ts`, `app/api/admin/orders/route.test.ts` | 🟡 |
| FR-ADMORD-4 отмена pending + причина | I4 | `lib/admin-orders.test.ts`, `lib/admin-orders-db.test.ts` | 🟡 |
| FR-ADMORD-5/6/7 переходы исполнения, запрет paid, аудит | I10 | `lib/admin-orders.test.ts`, `lib/admin-orders-db.test.ts` | 🟡 |
| FR-SET-1 тариф доставки | I10 | `app/api/admin/settings/delivery/route.test.ts` | ✅ |
| FR-SET-2, FR-NOTE-5 настройки/шифрование токена | BR-SEC-4 | `lib/telegram-settings.test.ts`, `app/api/admin/settings/notifications/route.test.ts` | ✅ |
| FR-NOTE-1…4 события, outbox, ретраи, формат | — | `lib/telegram-notifications.test.ts`, `lib/telegram-notifications.sender.test.ts` | 🟡 (live SKIP LOCKED/Telegram) |

### Сквозные правила

| Правило | Инв. | Тест | Статус |
| --- | --- | --- | --- |
| BR-MONEY-1 копейки INTEGER | I2 | `lib/price.test.ts` + `sql/schema.sql` | ✅ |
| BR-MONEY-2/3/4 серверный итог, snapshot цены, инвариант суммы | I9, I10 | `lib/orders.test.ts`, `lib/checkout-amounts.test.ts` | 🟡 |
| BR-MONEY-5 подпись на сервере | I1 | `lib/robokassa.test.ts` | ✅ |
| BR-SALE-1/2/3 окно скидки и snapshot | I2, I9 | `lib/pricing.test.ts`, `lib/orders.test.ts` | ✅ |
| BR-STATUS-1…5 статусы и переходы | I4, I10 | `lib/admin-orders-db.test.ts`, `app/api/robokassa/result.test.ts`, `sql/migrations/003_orders_delivery_and_admin_events.test.ts` | 🟡 |
| BR-DELIV-1…5 режим доставки и snapshot ПВЗ | I10 | `lib/orders.test.ts`, `sql/migrations/003_orders_delivery_and_admin_events.test.ts` | 🟡 |
| BR-SEC-1 анти-IDOR token | — | `lib/orders.test.ts` | 🟡 |
| BR-SEC-2/3 гард + секреты в .env | I7, I8 | `lib/auth.test.ts`, `.gitignore` | 🟡 |
| BR-SEC-5 index.html не редактируется | I6 | — | ⬜ ручная |

## Критические сценарии (e2e, после Ф3)

| Сценарий | Покрывает |
| --- | --- |
| Неверная подпись result URL → 400, статус не меняется | I1, I3 |
| result URL без подписи → 400 | I3 |
| Создать заказ → оплатить → статус `paid` | I3, I4 |
| Отменить `pending` в админке → `cancelled` + audit; поздний callback не подтверждается | I3, I4, I8 |
| Загрузить фото → появляется в vitrine | I5 |
| Цена в заказе совпадает с ценой в БД (в копейках) | I2 |
| Hidden товар нельзя открыть/заказать; unlisted доступен только по URL | I8, I9 |
| Временная скидка переключается на границах окна и фиксируется в заказе | I2, I9 |
| Выбор ПВЗ + тариф → в Робокассу уходит полная сумма; отгрузка не меняет `paid` | I2, I3, I8, I10 |

## Инструменты

Vitest (unit + mock-интеграционные) — `npm test` = `vitest run`. Playwright
подключён: `npm run test:e2e`, сценарий `e2e/checkout-price-changed.spec.ts`.
Он поднимает локальный Next.js и мокает внешние API; полный путь оплаты на
production в него не входит.
