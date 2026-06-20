# TESTING_PLAN — МАВИТА-ШОП

Дата: 2026-06-19

Трассировка тестов по инвариантам. Каждый инвариант из `PROJECT_CORE.md` должен получить тест до перехода в следующую фазу.

## Статус

> Ф0–Ф3 покрыты: 53 теста зелёные (`npm test`). I5 — в Ф4.

## Инварианты → тесты

| ID | Инвариант | Тип теста | Файл | Статус |
| --- | --- | --- | --- | --- |
| I1 | Подпись только на сервере, Password в .env | unit | `lib/robokassa.test.ts` | ✅ написан |
| I2 | Цены в копейках (INTEGER) | unit + schema | `sql/schema.sql` + `lib/price.test.ts` | ✅ написан |
| I3 | result URL проверяет подпись перед обновлением | интеграционный | `app/api/robokassa/result.test.ts` | ✅ написан |
| I4 | Статус меняется только через API (+ сверка суммы и audit ручной отмены) | интеграционный | `app/api/robokassa/result.test.ts`, `lib/admin-orders-db.test.ts`, `app/api/admin/orders/**/*.test.ts` | Робокасса ✅; admin-cancel — по `docs/specs/admin-orders.md` |
| I5 | Фото: файл + product_images атомарно | интеграционный | `app/api/upload.test.ts` | guards покрыты; нужен прогон с тестовой PostgreSQL/ФС |
| I6 | index.html не в .gitignore, не редактируется | structural | `—` | ручная проверка |
| I7 | .env не коммитится | structural | `.gitignore` | ручная проверка |
| I8 | Гард admin/upload, session, CSRF | unit + интеграционный | `lib/auth.test.ts`, `app/api/auth/*.test.ts`, `app/api/admin/**/*.test.ts` | unit покрыт; требуется интеграционный прогон с БД |
| I9 | Серверная effective price в транзакционном snapshot заказа | unit + интеграционный | `lib/pricing.test.ts`, `lib/orders.test.ts` | unit покрыт; требуется интеграционный тест блокировок в PostgreSQL |
| I10 | Доставка серверно рассчитана и входит в snapshot полной суммы; исполнение не подменяет оплату | unit + интеграционный | `lib/store-settings.test.ts`, `lib/orders.test.ts`, `app/api/robokassa/init.test.ts`, `lib/admin-orders-db.test.ts` | по `docs/specs/admin-orders.md` |

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

Vitest (unit + integration) — выбран в Ф0, `npm test` = `vitest run`. E2e (Playwright) — кандидат, не заведён.
