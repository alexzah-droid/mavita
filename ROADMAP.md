# ROADMAP — МАВИТА-ШОП

Дата актуализации: 2026-07-02

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
| Ф4 | Админ-панель | ✅ | К1–К3 на проде (миграции `001`–`021` подтверждены 2026-07-02); контур автоотправки СДЭК ждёт подтверждения первым боевым заказом |
| Ф5 | Деплой на VPS | 🚧 | Прод работает в боевом режиме (Робокасса с 2026-06-21, СДЭК с 2026-06-24); осталась автоматизация деплоя |

---

## Ф0 — Проектный фундамент ✅

Цель: данные перестают быть захардкоженными, появляется БД и серверный слой доступа.

**Сделано:**
- `shop/sql/schema.sql` — DDL для `products`, `product_images`, `orders`, `order_items`.
  Цены — `INTEGER` в копейках (инвариант **I2**).
- `shop/sql/seed.sql` — наполнение стартового каталога серии «Горы» в копейках.
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

- ✅ `lib/robokassa.ts` — подпись только на сервере (**I1**), Password1/Password2 из `.env`; алгоритм — `ROBOKASSA_HASH_ALGO` (на проде SHA-256 с 2026-06-23).
- ✅ `app/api/robokassa/init` — создаёт `pending`-заказ, считает подпись, возвращает URL оплаты.
- ✅ `app/api/robokassa/result` — принимает POST **и** GET (Робокасса в тест-режиме шлёт GET); проверяет подпись `Password2` (**I3**), ставит `paid`, отвечает `OK{InvId}`.
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
- Боевой режим (`ROBOKASSA_TEST_MODE=false`) включён 2026-06-21 (Пауза 1 пройдена);
  подпись переведена на SHA-256 синхронно с ЛК 2026-06-23. Реальные оплаты проходят.
- В ЛК Робокассы настроен POST для всех трёх URL (Result / Success / Fail).

---

## Ф4 — Админ-панель 🚧

Цель: владелец управляет ассортиментом без psql.

**Компонент 1 — авторизация + товары и витрина** ✅ (реализован, на проде 2026-06-20):
спецификация [docs/specs/done/admin-products.md](docs/specs/done/admin-products.md). Вводит
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

> **Усиление товаров (2026-06-22):** закрыты пять дефектов модуля —
> [docs/specs/done/admin-products-hardening.md](docs/specs/done/admin-products-hardening.md):
> локальное время скидки (DST-safe), проверка скидки по итоговому состоянию,
> атомарная сортировка фото с ответом `{ images }`, архивирование + hard delete с
> подтверждением имени, transaction-scoped advisory lock витрины. Добавлен
> `npm run test:integration` (реальный PostgreSQL) и concurrency-/e2e-тесты.

**Компонент 2 — заказы** ✅ (на проде; rollout подтверждён — см. P0-1):
спецификация [docs/specs/done/admin-orders.md](docs/specs/done/admin-orders.md).
- ✅ Checkout: server-side snapshot товаров и, при активной доставке, тарифа и
  полной суммы (**I10**). Режим доставки вычисляется сервером:
  `disabled/pickup_required/error`; глобальный `DELIVERY_ENABLED=false` теперь
  трактуется как аварийный global off, а не как основной rollout-сценарий.
- ✅ Публичная страница **«Доставка»** (`app/delivery`) описывает текущий сценарий
  с ПВЗ СДЭК и больше не конфликтует с документацией checkout.
- ✅ `app/admin/orders` — список, ПВЗ/трек, статусы исполнения и карточка заказа.
- ✅ `POST /api/admin/orders/[id]/cancel|fulfillment` — отмена `pending` и аудит отгрузки; ручного `paid` нет.
- ✅ `app/admin/settings/delivery` — настройки СДЭК: тариф, ключи, проверка связи.
- ✅ `app/admin/CdekShipmentSettingsForm.tsx` + `lib/cdek-shipment.ts` — автоотправка,
  webhook, обновление накладной/штрихкода в карточке заказа.
- ✅ Миграция `003` — доставка, `store_settings`, `order_admin_events` и индексы.

**Production rollout К2 подтверждён** (миграции, создание заказа, ResultURL и
сценарий СДЭК — см. P0-1 и [docs/environments.md](docs/environments.md)).
`DELIVERY_ENABLED=false` остаётся аварийным отключением с фиксацией причины.

**Тесты:** `lib/auth.test.ts` (I8), `lib/pricing.test.ts`, `lib/orders.test.ts` (I9), `app/api/upload/route.test.ts` + `app/api/admin/products/[id]/images/route.test.ts` (I5, cover-инвариант TD-23, распознавание WebP TD-24).

**Компонент 3 — доставка СДЭК и серверные настройки перевозчика** ✅ (на проде с 2026-06-24):
спеки [docs/specs/done/admin-delivery-settings.md](docs/specs/done/admin-delivery-settings.md),
[docs/specs/done/cdek-pvz.md](docs/specs/done/cdek-pvz.md),
[docs/specs/done/cdek-auto-shipment.md](docs/specs/done/cdek-auto-shipment.md). Текущее
состояние репозитория уже без Ozon в рантайме: интеграция снята миграцией
`013_drop_ozon.sql`, а схема и код снова сфокусированы на одном перевозчике.
- ✅ `lib/secret-box{,-core}.ts` — AES-256-GCM (версия+AAD), секреты СДЭК в БД
  хранятся шифрованными; мастер-ключ `SETTINGS_ENC_KEY` только в `.env`.
- ✅ Миграции `005`/`006` заложили per-carrier модель и шифрование; миграция
  `013_drop_ozon.sql` убрала Ozon-ветку и ужесточила продукт обратно до СДЭК.
- ✅ `lib/store-settings.ts` — `resolveDeliveryMode` (disabled/pickup_required/error,
  fail closed), runtime/stored credentials, locked snapshot, атомарные save/clear.
- ✅ `lib/cdek.ts` — OAuth, поиск городов/ПВЗ, прокси виджета, кэш точек выдачи.
- ✅ `lib/cdek-shipment.ts`, `lib/cdek-outbox.ts`, admin API и UI — автосоздание,
  повтор, аннулирование и webhook-обновление отправлений СДЭК.
- ✅ Операционка: `backfill-delivery-credentials.ts`, `rotate-delivery-settings-key.ts`,
  `cdek:drain`, manual launch/runbook в `docs/specs/` и `docs/operations.md`.

**Delivery rollout подтверждён** (боевые ключи, выбор ПВЗ, тариф — работают на
проде). Открыт один хвост: боевое подтверждение `auto-shipment → webhook →
waybill/barcode` на первом реальном заказе после включения автоотправки (P0-1).
Отдельные будущие перевозчики планируются как новые фазы, не как «скрыто
готовая» часть текущего релиза.

**Тесты:** `lib/secret-box.test.ts`, `lib/store-settings.test.ts`,
`lib/cdek.test.ts`, `lib/ops-alert.test.ts`, `lib/orders.createOrder.test.ts`,
миграции `005`, `006`, `013`, API-роуты доставки и настройки СДЭК.

---

## Ф5 — Деплой на VPS 🚧

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
- ✅ Переключение `ROBOKASSA_TEST_MODE=false` — выполнено 2026-06-21 (Пауза 1 пройдена);
  SHA-256 в `.env` и ЛК — 2026-06-23. Детали — [docs/environments.md](docs/environments.md).
- ✅ СДЭК-ПВЗ включён на checkout 2026-06-24 (`DELIVERY_ENABLED=true`, ключи в БД шифрованно).
- ✅ Миграции `001`–`021` применены на проде (ключевые объекты подтверждены 2026-07-02).
- ⬜ Автоматизация деплоя: sync кода → при изменении lockfile `npm ci` → build → `pm2 reload`.

**Тестовый стенд** (`147.45.72.20`, `invoice-vps`):
- Используется при необходимости; вход `ssh invoice-vps`.
- МАВИТА в Docker на порту **4000** (`http://147.45.72.20:4000/`); соседи invoice-lifecycle на 3000/3001.

---

## Критический путь до первой продажи — пройден

Все шаги пути (деплой, миграции, ResultURL, delivery-flow СДЭК, боевой режим
Робокассы) выполнены; реальные оплаты идут с 2026-06-21. Открытым остаётся одно
боевое подтверждение: контур `auto-shipment → webhook → waybill/barcode` на первом
реальном заказе после включения автоотправки (см. P0-1 ниже).

---

## Реализационный план после критического ревью

Ниже — приоритеты по итогам критического чтения
`docs/specs/admin-security.md`, `docs/specs/delivery-options.md`,
`docs/specs/yandex-delivery-pvz.md`, `docs/specs/rupost-integration.md`,
`docs/tech-debt.md` и `mavita-audit.md`.
Источник release-gate и статусов — этот `ROADMAP.md`, `docs/tech-debt.md` и
актуализированные planning specs из `docs/specs/`;
`mavita-audit.md` используем как источник UX/SEO-гипотез, но не как источник
security- или rollout-статуса. `admin-security` уже обновлён под текущий код:
login rate-limit реализован process-local, поэтому следующий шаг — усилить его
до PG-backed limiter, добавить audit и затем TOTP.

### P0 — До приёма реальных денег

1. **✅ Rollout-гейты продакшена подтверждены.**
   - На production подтверждены фактически применённые миграции `003`, `015`–`018`,
     а также live-сценарий `create order → Robokassa ResultURL → выбор ПВЗ СДЭК → paid`.
   - Уточнение: исторические production-заказы с ПВЗ были оформлены **до** включения
     синхронизации с автосозданием накладных СДЭК, поэтому подтверждение контура
     `auto-shipment → webhook → waybill/barcode` переносится на следующий реальный заказ.

2. **Закрыть `TD-26`: автотесты на контур автоотправки СДЭК.**
   - Минимум: happy/failure-path для settings API, webhook, retry/requeue и
     drain-воркера.
   - Причина: это единственный явно незакрытый хвост в критичном послеоплатном
     контуре.

3. **Дозакрыть платёжный ops-хвост.**
   - ✅ SHA-256 (`TD-20`) и боевые пароли (`TD-7`) закрыты: боевой режим с 2026-06-21,
     реальные оплаты проходят.
   - Осталось: заполнить `ROBOKASSA_RESULT_IPS` (`TD-19`) и подтвердить чеки
     НПД/«Мой налог» по фактическим боевым оплатам (`TD-14`).

### P1 — Усиление существующей админ-авторизации

4. **Закрыть `TD-27`: заменить process-local login rate-limit на общий для всех инстансов.**
   - Вместо in-memory `Map` в login route — общий PG-backed limiter по паттерну
     `delivery_test_attempts`, с advisory lock и `Retry-After`.
   - Нормализовать trusted IP через контракт Nginx (`X-Forwarded-For` /
     `X-Real-IP`), не полагаться на произвольную клиентскую цепочку.
   - Причина: текущий лимитер уже есть, но он не разделяется между процессами и
     слабее production-сценария за прокси.

5. **Закрыть `TD-28`: сократить риск от украденной admin-сессии.**
   - Уменьшить TTL/idle timeout админской сессии с 8 часов до 30–60 минут
     неактивности.
   - Причина: это дешёвое усиление с большим выигрышем по риску.

6. **Закрыть `TD-29`: добавить аудит входов в админку.**
   - Таблица `admin_login_log`, логирование success/failed, причина, IP,
     user-agent, минимальный просмотр в админке.
   - Причина: без этого нет наблюдаемости; любые алерты по новым IP будут
     слепыми.

### P2 — Усиление доступа владельца

7. **Закрыть `TD-30`: добавить MFA через TOTP + backup codes.**
   - Основной путь: TOTP (Google Authenticator/Authy), backup codes в хеше,
     secret в БД шифрованно.
   - Не брать как основной путь email OTP: он слабее TOTP и операционно более
     хрупкий.
   - Причина: это следующий серьёзный скачок безопасности после журнала входов
     и сокращения TTL.

### P3 — Публичный checkout и антиабуз

8. **Вернуться к `TD-15`: антиспам/anti-abuse на создание заказа.**
   - Сначала серверный rate-limit/anti-abuse для `POST /api/robokassa/init`,
     затем уже captcha только при подтверждённом спаме.
   - Причина: captcha ухудшает UX и должна быть следствием реального абуза, а
     не дефолтной первой мерой.

### P4 — SEO-техническая база

9. **✅ Закрыт базовый technical SEO.**
   - Добавлены `robots`, `sitemap`, canonical/Open Graph/Twitter metadata на
     ключевых публичных страницах, JSON-LD (`Organization`/`WebSite` на
     витрине, `Product` на карточке товара).
   - Служебные страницы (`/admin`, `/cart`, `/checkout`, `/order/<token>`)
     закрыты от индексации.
   - Проверка: `lib/seo.test.ts`, `npm run typecheck`, `npm test`.

10. **Усилить карточки товара контентом.**
   - ✅ Инфраструктура характеристик готова (2026-07-02, миграция `020`): вес,
     время горения, состав воска, фитиль — поля в админке, блок на карточке,
     пустые скрываются. Плюс строка стоимости доставки на карточке.
   - Осталось: владелец заполняет характеристики по каждому товару; usage hints
     и сведения о декларации/качестве — по мере появления контента.
   - Причина: это одновременно UX-, trust- и SEO-улучшение.

### P5 — После стабилизации продающего контура

11. **✅ Подключить базовую аналитику + события воронки.**
   - Яндекс.Метрика `110274888` развернута на production: публичные маршруты,
     SPA-hit для App Router (2026-07-01).
   - С 2026-07-02 отправляются ecommerce-события воронки: `add_to_cart`,
     `begin_checkout`, `purchase` (`app/components/metrikaEvents.ts`).
   - `/admin*` не трекается. `/order` трекается обезличенно: hit без токена
     заказа, вебвизор на этих страницах выключен (иначе purchase было бы
     некуда отправлять).
   - Документировано в `docs/specs/done/yandex-metrika.md`; `/privacy`
     обновлена под веб-аналитику.
   - Осталось: создать цели `add_to_cart`/`begin_checkout`/`purchase` в кабинете
     Метрики; отзывы и GA4 — отдельные задачи.

12. **Планировать расширение доставки только через актуальные specs.**
   - База: `docs/specs/delivery-options.md`.
   - Яндекс Доставка: сначала Gate 0 из `docs/specs/yandex-delivery-pvz.md`,
     затем отдельная реализационная спека.
   - Почта России: сначала `docs/specs/rupost-api-revalidation.md`, затем
     `rupost-address-checkout.md`, затем `rupost-batches-admin.md`.
   - `docs/specs/done/cdek-manual-launch.md` — historical/reference: ручной
     СДЭК был реализован иначе и не является текущим ТЗ.

### Не брать в ближайший цикл

- WebAuthn / FIDO2: хороший future option, но не первая инвестиция при текущем масштабе.
- Email OTP как основной MFA: слабее TOTP.
- reCAPTCHA “на всякий случай”: только если серверного anti-abuse окажется недостаточно.
- Общие чеклисты вроде “добавить CSP/HSTS/CORS” без привязки к реальному threat model:
  делать отдельным hardening-заходом, а не вместо конкретных release-гейтов выше.

---

## Масштабирование (после запуска)

См. [architecture.md](architecture.md) §«Масштабирование»: категории при 20→100 товарах,
переезд фото на S3, апгрейд VPS под трафик.
