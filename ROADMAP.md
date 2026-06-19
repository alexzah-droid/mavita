# ROADMAP — МАВИТА-ШОП

Дата: 2026-06-20

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
| Ф3 | Оплата Робокасса | ⬜ | Подпись, init/result/success/fail |
| Ф4 | Админ-панель | ⬜ | Управление товарами, фото, заказами |
| Ф5 | Деплой на VPS | 🚧 | Тестовый стенд (в работе); production (далее) |

---

## Ф0 — Проектный фундамент ✅

Цель: данные перестают быть захардкоженными, появляется БД и серверный слой доступа.

**Сделано:**
- `shop/sql/schema.sql` — DDL для `products`, `product_images`, `orders`, `order_items`.
  Цены — `INTEGER` в копейках (инвариант **I2**).
- `shop/sql/seed.sql` — наполнение каталога (4 свечи серии «Горы») в копейках.
- `shop/lib/db.ts` — пул соединений `pg`, singleton, читает `DATABASE_URL`.
- `shop/lib/price.ts` — конвертация и форматирование копеек (рубли ⇄ копейки, `formatRub`).
- `shop/lib/products.ts` — типы + seed-данные + async-функции выборки из БД
  с graceful-фоллбэком на seed, если БД недоступна (для локальной разработки и CI-сборки).
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
- `app/api/orders/route.ts` — `POST`, пересчёт сумм на сервере, заказ `pending`.
- `app/order/[id]/page.tsx` — «заказ принят» (читает заказ из БД).
- `app/components/ShopHeader.tsx` — общая шапка внутренних страниц (корзина видна на мобильных).

**Тесты:** `lib/cart.test.ts` (корзина), `lib/orders.test.ts` (валидация формы,
сборка позиций, snapshot цены из каталога, товар не найден / нет в наличии).

**Далее:** оплата — в Ф3 (Робокасса). Сейчас заказ создаётся со статусом `pending`.

---

## Ф3 — Оплата Робокасса ⬜

Цель: заказ можно оплатить.

- ⬜ `lib/robokassa.ts` — MD5-подпись только на сервере (**I1**), Password1/Password2 из `.env`.
- ⬜ `app/api/robokassa/init` — pending-заказ, подпись, редирект в Робокассу.
- ⬜ `app/api/robokassa/result` — проверка `MD5(Password2)` до смены статуса (**I3**, **I4**), ответ `OK{InvId}`.
- ⬜ `app/api/robokassa/success` / `fail` — редиректы покупателя.

**Тесты:** `lib/robokassa.test.ts` (I1), `app/api/robokassa/result.test.ts` (I3, I4).

> Блокеры: регистрация в Робокассе ждёт домена; `ROBOKASSA_TEST_MODE=true` до явной Паузы 1.

---

## Ф4 — Админ-панель ⬜

Цель: владелец управляет ассортиментом без psql.

- ⬜ `lib/auth.ts` + `app/api/auth` — вход по паролю через iron-session.
- ⬜ `app/admin` — список товаров, CRUD, drag-and-drop сортировка.
- ⬜ `app/api/upload` — загрузка фото, файл + `product_images` атомарно (**I5**).
- ⬜ `app/admin/orders` — список заказов с фильтром по статусу.

**Тесты:** `app/api/upload.test.ts` (I5).

---

## Ф5 — Деплой на VPS 🚧

Цель: магазин доступен снаружи на `mavita.ru`.

**Прод VPS** (`45.130.147.108`, `mavita.ru`, см. [docs/environments.md](docs/environments.md)):
- ✅ Выделенный VPS: Ubuntu 22.04, 1 vCPU, 1 GB RAM + 2 GB swap, 10 GB NVMe.
- ✅ Провижининг: Node.js 20, PostgreSQL 16, Nginx, PM2, Certbot, UFW.
- ✅ БД `mavita` и пользователь `mavita` созданы.
- ✅ `/var/www/mavita/` с `.env` (DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD).
- ✅ nginx vhost для `mavita.ru` и `www.mavita.ru` → proxy `:3000`.
- ✅ Домен `mavita.ru` куплен (2026-06-20).
- 🚧 DNS A-записи прописаны, ждём propagation.
- ⬜ SSL через certbot (после propagation DNS).
- ⬜ Первый деплой кода: `git clone`, `npm ci && npm run build`, `pm2 start`.
- ⬜ Применить `sql/schema.sql` + `sql/seed.sql`.
- ⬜ `docs/operations.md` — runbook деплоя/отката (создать при первом деплое).
- ⬜ GitHub Actions: `git pull → npm ci → npm run build → pm2 reload mavita`.
- ⬜ Переключение `ROBOKASSA_TEST_MODE=false` — **Пауза 1** (после регистрации в Робокассе).

**Тестовый стенд** (`147.45.72.20`, `invoice-vps`):
- Используется при необходимости; вход `ssh invoice-vps`.
- МАВИТА на порту 3002, соседи invoice-lifecycle на 3000/3001.

---

## Критический путь до первой продажи

```
Ф0 ✅ → Ф1 ✅ → Ф2 (корзина ✅ → оформление) → Ф3 (Робокасса) → Ф5 (деплой)
```

Полноценная админка (Ф4) не на критическом пути: до неё товары наполняются через
`sql/seed.sql` / psql.

---

## Масштабирование (после запуска)

См. [architecture.md](architecture.md) §«Масштабирование»: категории при 20→100 товарах,
переезд фото на S3, апгрейд VPS под трафик.
