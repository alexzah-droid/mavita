# TESTING_PLAN — МАВИТА-ШОП

Дата актуализации: 2026-06-21

Трассировка тестов по инвариантам. Каждый инвариант из `PROJECT_CORE.md` должен получить тест до перехода в следующую фазу.

## Статус

> 128 тестов в 27 файлах зелёные (`npm test`, 2026-06-21). Покрыты Ф0–Ф3 и
> оба компонента Ф4; `npm run typecheck` также проходит.
> I5/I8/I9/I10 покрыты unit/mock-интеграционными тестами. Прогон с реальной
> PostgreSQL/ФС, CDEK и Робокассой остаётся отдельной проверкой стенда.

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
