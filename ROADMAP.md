# ROADMAP — МАВИТА-ШОП

Дата актуализации: 2026-06-21

План развития интернет-магазина свечей МАВИТА. Фазы совпадают с нумерацией в
[PROJECT_CORE.md](PROJECT_CORE.md) (§6). Этот документ — «что и в каком порядке»;
архитектурные детали — в [architecture.md](architecture.md), инварианты — в
[PROJECT_CORE.md](PROJECT_CORE.md) §5, трассировка тестов — в [TESTING_PLAN.md](TESTING_PLAN.md).

Легенда статусов: ✅ готово · 🚧 в работе · ⬜ не начато.

---

## Обзор фаз

| Фаза | Название | Статус | Результат |
| --- | --- | --- | --- |
| Ф0 | Проектный фундамент | ✅ | БД, data-слой, API товаров, тесты, `.env.example` |
| Ф1 | Витрина и каталог | ✅ | Витрина и карточка товара читают данные из БД |
| Ф2 | Корзина и оформление | ✅ | Корзина + оформление заказа (заказ создаётся в БД) |
| Ф3 | Оплата Робокасса | ✅ | Подпись, init/result/success/fail; тестовый платёж прошёл |
| Ф4 | Админ-панель | 🚧 | К1 на проде; К2 реализован в репозитории, ожидает production rollout |
| Ф5 | Деплой на VPS | 🚧 | Прод запущен; текущий релиз ожидает backup, миграцию `003` и проверку |

---

## Ф0 — Проектный фундамент ✅

Цель: данные перестают быть захардкоженными, появляется БД и серверный слой доступа.

**Сделано:**
- `shop/sql/schema.sql` — DDL для `products`, `product_images`, `orders`, `order_items`.
  Цены — `INTEGER` в копейках (инвариант **I2**).
- `shop/sql/seed.sql` — наполнение каталога (4 свечи серии «Горы») в копейках.
- `shop/lib/db.ts` — пул соединений `pg`, singleton, читает `DATABASE_URL`.
- `shop/lib/price.ts` — конвертация и форматирование копеек (рубли ⇄ копейки, `formatRub`).
- `shop/lib/products.ts` — типы и seed-данные; серверный `lib/catalog.ts` использует
  seed только при отсутствии `DATABASE_URL`. При настроенной, но недоступной БД
  возвращается нейтральный `503`, а не seed-каталог.
- `shop/app/api/products/route.ts` — `GET /api/products`, отдаёт каталог из БД.
- `shop/.env.example` — единственный публичный список переменных.
- Vitest как раннер (юнит + интеграция).

**Тесты:** `lib/price.test.ts` (I2), `lib/products.test.ts` (маппинг строк БД → товар,
фоллбэк), `app/api/products.test.ts` (форма ответа).

---

## Ф1 — Витрина и каталог ✅

Цель: публичная витрина работает на реальных данных.

**Сделано:**
- `app/page.tsx` — серверный компонент: тянет товары через data-слой, передаёт в клиентский
  `HomeClient` (скролл/reveal-эффекты остаются на клиенте).
- `app/product/[slug]/page.tsx` — карточка товара из БД (с фоллбэком на seed).
- Цены форматируются через `lib/price.ts`, наличие — из `in_stock`.
- `app/components/ProductGallery.tsx` — галерея нескольких фото в карточке; вывод ароматов и атрибутов товара, фото автора (редизайн 2026-06-20).

---

## Ф2 — Корзина и оформление ✅

Цель: покупатель собирает заказ и оставляет контакты.

**Сделано (корзина):**
- `lib/cart.ts` — чистая логика корзины (add / remove / setQty / итоги), без UI → тестируется юнитами.
- `app/cart/CartProvider.tsx` — React Context поверх `lib/cart.ts`, персист в `localStorage`.
- Кнопки «В корзину» на витрине и в карточке товара, счётчик в шапке.
- `app/cart/page.tsx` — страница корзины: список позиций, изменение количества, итог.

**Сделано (оформление):**
- `app/checkout/page.tsx` — форма: имя, email, телефон; сводка заказа; обработка ошибок.
- `lib/orders.ts` — валидация (чистая), сборка позиций из каталога (snapshot названия/цены,
  цена берётся из БД, не от клиента → защита от подмены), `createOrder`/`getOrder`.
- `lib/db.ts` — `withTransaction`: заказ + `order_items` создаются атомарно.
- `app/api/robokassa/init/route.ts` — `POST`, пересчёт сумм на сервере, создание
  заказа `pending` и URL оплаты.
- `app/order/[token]/page.tsx` — страница заказа по неугадываемому token.
- `app/components/ShopHeader.tsx` — общая шапка внутренних страниц (корзина видна на мобильных).

**Тесты:** `lib/cart.test.ts` (корзина), `lib/orders.test.ts` (валидация формы,
сборка позиций, snapshot цены из каталога, товар не найден / нет в наличии).

**Далее:** оплата — в Ф3 (Робокасса). Сейчас заказ создаётся со статусом `pending`.

---

## Ф3 — Оплата Робокасса ✅

Цель: заказ можно оплатить.

- ✅ `lib/robokassa.ts` — MD5-подпись только на сервере (**I1**), Password1/Password2 из `.env`.
- ✅ `app/api/robokassa/init` — создаёт `pending`-заказ, считает подпись, возвращает URL оплаты.
- ✅ `app/api/robokassa/result` — принимает POST **и** GET (Робокасса в тест-режиме шлёт GET); проверяет `MD5(Password2)` (**I3**), ставит `paid`, отвечает `OK{InvId}`.
- ✅ `app/api/robokassa/success` / `fail` — редиректы покупателя на `/order/[token]`.

**Проверено 2026-06-20:** тестовый платёж через форму Робокассы (`IsTest=1`), статус заказа сменился `pending → paid`, `robokassa_data` записан в БД.

**Хардненинг по ревью 2026-06-20** (детали — [docs/tech-debt.md](docs/tech-debt.md)):
- TD-1: заказ адресуется неугадываемым `token` (был IDOR по серийному `/order/<id>`). Требует миграции на проде — см. Ф5.
- TD-2: баннер «оплачено» — по `status` в БД, не по `?paid`.
- TD-4: `result` сверяет `OutSum` с суммой заказа (защита от недоплаты).
- TD-3: добавлены тесты подписи и result (I1/I3/I4).
- TD-8: удалён дубль-маршрут `POST /api/orders`.

**Особенности реализации:**
- В тестовом режиме Робокасса шлёт GET с `OutSum=1800` (без `.00`). Handler принимает оба метода.
- `ROBOKASSA_TEST_MODE=true` на проде до явного переключения (Пауза 1).
- В ЛК Робокассы настроен POST для всех трёх URL (Result / Success / Fail).

---

## Ф4 — Админ-панель 🚧

Цель: владелец управляет ассортиментом без psql.

**Компонент 1 — авторизация + товары и витрина** ✅ (реализован, на проде 2026-06-20):
спецификация [docs/specs/admin-products.md](docs/specs/admin-products.md). Вводит
инварианты **I8** (гард админки) и **I9** (серверная эффективная цена заказа).

- ✅ `lib/auth.ts` + `app/api/auth/login|logout` + `app/admin/login` — вход по паролю через iron-session, `requireAdminPage()`/`requireAdminApi()`-гарды, rate-limit (**I8**).
- ✅ Миграция `002` — `products.visibility` (`public`/`unlisted`/`hidden`) + поля скидки (`sale_price_kopecks`, `sale_starts_at`, `sale_ends_at`).
- ✅ `lib/pricing.ts` — чистый расчёт эффективной цены (скидка по таймеру).
- ✅ `lib/catalog.ts` / `lib/orders.ts` — фильтры видимости + snapshot скидочной цены при оформлении (**I9**, security-критично).
- ✅ `app/admin` — список товаров, CRUD, drag-and-drop сортировка, управление витриной и скидками.
- ✅ `app/api/upload` — загрузка фото, файл + `product_images` атомарно (**I5**).

> **CSRF за прокси (фикс 2026-06-20):** `assertSameOrigin` сверяет хост `Origin` с
> заголовком `Host`, а не полный origin: `next start` за Nginx строит `request.url`
> как `http://`, из-за чего вход в админку на проде падал «Неверный Origin». См. TD-22.

**Компонент 2 — заказы** 🚧 (реализован в репозитории, rollout не подтверждён):
спецификация [docs/specs/admin-orders.md](docs/specs/admin-orders.md).
- ✅ Checkout: server-side snapshot товаров и, при включённой доставке, тарифа и
  полной суммы (**I10**). Сейчас `DELIVERY_ENABLED=false`: заказ оформляется без
  ПВЗ и с `delivery_kopecks=0`. Спека включения СДЭК: [docs/specs/cdek-pvz.md](docs/specs/cdek-pvz.md).
- ✅ Публичная страница **«Доставка»** (`app/delivery`) — описывает схему доставки для покупателя: доставка в ПВЗ СДЭК, текущая стоимость (фикс/бесплатно из `store_settings`), сроки, оплата на сайте (предоплата), что покупатель СДЭКу отдельно не платит. Ссылки в шапке, футере и на checkout. Контент — из «денежного потока» в [docs/specs/cdek-pvz.md](docs/specs/cdek-pvz.md).
- ✅ `app/admin/orders` — список, ПВЗ/трек, статусы исполнения и карточка заказа.
- ✅ `POST /api/admin/orders/[id]/cancel|fulfillment` — отмена `pending` и аудит отгрузки; ручного `paid` нет.
- ✅ `app/admin/settings/delivery` — фиксированный тариф СДЭК до ПВЗ.
- ✅ Миграция `003` — доставка, `store_settings`, `order_admin_events` и индексы.

**Перед production rollout К2:** backup PostgreSQL → применить миграцию `003` →
сохранить `DELIVERY_ENABLED=false` → проверить создание и ResultURL реального
платежа. Включение СДЭК — последующий отдельный gate (Пауза 2 + OAuth-ключи).

**Тесты:** `lib/auth.test.ts` (I8), `lib/pricing.test.ts`, `lib/orders.test.ts` (I9), `app/api/upload/route.test.ts` + `app/api/admin/products/[id]/images/route.test.ts` (I5, cover-инвариант TD-23, распознавание WebP TD-24).

---

## Ф5 — Деплой на VPS ✅

Цель: магазин доступен снаружи на `mavita.ru`.

**Прод VPS** (`45.130.147.108`, `mavita.ru`, см. [docs/environments.md](docs/environments.md)):
- ✅ Выделенный VPS: Ubuntu 22.04, 1 vCPU, 1 GB RAM + 2 GB swap, 10 GB NVMe.
- ✅ Провижининг: Node.js 20, PostgreSQL 16, Nginx, PM2, Certbot, UFW.
- ✅ БД `mavita`, пользователь `mavita`, исходная схема и миграции `001`/`002` применены.
- ✅ Nginx vhost для `mavita.ru` и `www.mavita.ru` → proxy `:3000`.
- ✅ Домен `mavita.ru` куплен (2026-06-20), DNS пропагирован.
- ✅ SSL через Certbot выпущен: истекает 2026-09-17, автопродление активно.
- ✅ Код задеплоен (2026-06-20): репозиторий в `/var/www/mavita-repo/`, PM2 запускает из `/var/www/mavita-repo/shop/`.
- ✅ `.env` заполнен: DATABASE_URL, ROBOKASSA_LOGIN/PASSWORD1/PASSWORD2, SESSION_SECRET, ADMIN_PASSWORD.
- ✅ `docs/operations.md` — создан.
- ✅ Тестовый платёж через Робокассу (`IsTest=1`) прошёл, `pending → paid` работает (2026-06-20).
- ✅ Миграции `001_order_token.sql` (TD-1) и `002_admin_visibility_discount.sql` (видимость + скидки) применены на проде (2026-06-20).
- ✅ Деплой админки (Ф4 К1) + редизайн витрины с галереей фото товара (2026-06-20).
- ⬜ Для текущего релиза: backup + миграция `003_orders_delivery_and_admin_events.sql`;
  не отмечать как применённую, пока это не подтверждено на VPS.
- ⬜ GitHub Actions: `git pull → npm run build → pm2 reload mavita` (автоматизация деплоя).
- ⬜ Переключение `ROBOKASSA_TEST_MODE=false` — **Пауза 1** (после регистрации Робокассы на боевой режим).

**Тестовый стенд** (`147.45.72.20`, `invoice-vps`):
- Используется при необходимости; вход `ssh invoice-vps`.
- МАВИТА в Docker на порту **4000** (`http://147.45.72.20:4000/`); соседи invoice-lifecycle на 3000/3001.

---

## Критический путь до первой продажи

```
Ф0 ✅ → Ф1 ✅ → Ф2 ✅ → Ф3 ✅ → backup + миграция 003 → deploy + ResultURL check
→ реальный режим Робокассы (Пауза 1)
```

Полноценная админка (Ф4) не на критическом пути: до неё товары наполняются через
`sql/seed.sql` / psql.

---

## Масштабирование (после запуска)

См. [architecture.md](architecture.md) §«Масштабирование»: категории при 20→100 товарах,
переезд фото на S3, апгрейд VPS под трафик.
