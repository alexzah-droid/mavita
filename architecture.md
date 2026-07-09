# Архитектура: интернет-магазин свечей МАВИТА

## Что строим

Интернет-магазин с витриной, корзиной, оплатой через Робокассу и админ-панелью для управления товарами. Всё на одном VPS.

---

## Сервер

| Параметр | Значение |
|---|---|
| ОС | Ubuntu 22.04 LTS |
| IP | `45.130.147.108` |
| Домен | `mavita.ru` |
| CPU | 1 vCPU (KVM) |
| RAM | 1 GB + 2 GB swap |
| Диск | 10 GB NVMe |

**Распределение RAM в продакшне:**

| Процесс | Потребление |
|---|---|
| Nginx | ~20 MB |
| Next.js (Node, PM2) | ~300 MB |
| PostgreSQL | ~150 MB |
| ОС | ~150 MB |
| Резерв | ~380 MB |

> Swap 2 GB добавлен на случай пиковой нагрузки при `npm run build` (~700 MB).

---

## Стек

```
Nginx 1.24           — reverse proxy, SSL-терминация, отдача загруженных файлов
Next.js 15           — фронтенд (витрина) + API Routes (бэкенд) + App Router
PostgreSQL 16        — основная БД
PM2                  — process manager для Node.js
Certbot              — Let's Encrypt SSL
```

Нет отдельного бэкенд-сервера — Next.js App Router покрывает и SSR-страницы, и все API-эндпоинты.

---

## Структура проекта

```
/
├── app/
│   ├── page.tsx                  — витрина (каталог товаров)
│   ├── product/[slug]/page.tsx   — карточка товара
│   ├── cart/page.tsx             — корзина
│   ├── checkout/page.tsx         — оформление заказа
│   ├── order/[token]/page.tsx    — страница заказа по неугадываемому token
│   │
│   ├── admin/                    — админ-панель (защищена паролем)
│   │   ├── page.tsx              — список товаров
│   │   ├── products/new/         — создать товар
│   │   ├── products/[id]/edit/   — редактировать товар
│   │   ├── orders/               — список и карточка заказов
│   │   ├── settings/content/     — тексты «О бренде» и плиток «Три стихии»
│   │   └── settings/delivery/    — СДЭК: ключи, тариф, автоотправка, webhook
│   │
│   └── api/
│       ├── products/             — публичный каталог (GET)
│       ├── admin/                — CRUD товаров, заказы и настройки (admin-only)
│       │   ├── settings/delivery/{,clear,test} — ключи/тариф СДЭК, удаление, «проверить связь»
│       │   └── settings/cdek-shipment{/webhook} — настройки автоотправки и регистрация вебхука СДЭК
│       ├── upload/               — загрузка фотографий
│       ├── cdek/                 — поиск ПВЗ/городов СДЭК, widget proxy, webhook
│       ├── checkout/delivery/    — серверный режим доставки: disabled / pickup_required / error
│       ├── robokassa/
│       │   ├── init/             — формирование подписи, редирект в Робокассу
│       │   ├── result/           — ResultURL (сервер→сервер, подтверждение оплаты)
│       │   ├── success/          — SuccessURL (редирект покупателя)
│       │   └── fail/             — FailURL
│       └── auth/                 — логин/логаут для админки
│
├── lib/
│   ├── db.ts                     — Postgres-клиент (pg / postgres.js)
│   ├── robokassa.ts              — генерация и проверка подписи (алгоритм — ROBOKASSA_HASH_ALGO; на проде SHA-256)
│   ├── auth.ts                   — сессия для админки (iron-session)
│   ├── orders.ts                 — snapshot заказа, оплаты и delivery
│   ├── secret-box{,-core}.ts     — AES-256-GCM шифрование ключей перевозчиков (server-only обёртка + core)
│   ├── store-settings.ts         — режим доставки, credentials СДЭК, locked snapshot, настройки автоотправки
│   ├── site-content.ts           — чтение, валидация и сохранение контента главной
│   ├── delivery/                 — общий интерфейс провайдера ПВЗ
│   ├── cdek.ts                   — СДЭК: OAuth, города/ПВЗ, widget proxy
│   ├── cdek-shipment.ts          — создание/аннулирование отправлений, waybill/barcode, webhook helpers
│   ├── cdek-outbox.ts            — outbox-дрейнер задач автоотправки СДЭК
│   ├── telegram-notifications.ts — outbox уведомлений владельцу о заказах (drain по systemd-таймеру)
│   └── ops-alert.ts              — алерт оператору (Telegram) с подтверждением доставки
│
├── public/
│   └── uploads/                  — загружаемые фото товаров
│       └── products/
│
└── sql/
    ├── schema.sql                — DDL только для свежей БД
    └── migrations/               — последовательные ALTER-миграции production-БД
```

---

## База данных

Канонический исполнимый DDL — [shop/sql/schema.sql](shop/sql/schema.sql); для
уже развёрнутой БД применяются только недостающие файлы из
`shop/sql/migrations/`, а не повторный `schema.sql`.

| Сущность | Существенные поля и ограничения |
| --- | --- |
| `products` | `price_kopecks INTEGER`, visibility, окно скидки, `updated_at`; вес/габариты для СДЭК (миграция `015`) и публичные характеристики — время горения, воск, фитиль (миграция `020`), вес чистого воска (миграция `022`); эффективная цена считается в `lib/pricing.ts` |
| `product_images` | несколько фото, единственная обложка на товар через partial unique index |
| `orders` | неугадываемый `token`, `inv_id`, `items_kopecks + delivery_kopecks = total_kopecks`, payment status и отдельный fulfillment status; `customer_comment` — необязательный комментарий покупателя ≤500 символов (миграция `021`) |
| `order_items` | snapshot названия, цены и количества позиции |
| `store_settings` | синглтон: флаг/тариф СДЭК, **шифрованные** credentials (`cdek_client_id`, `cdek_client_secret_enc`) и параметры автоотправки; открытый секрет в БД не хранится |
| `order_admin_events` | неизменяемый аудит отмены, переходов исполнения и `cdek_status_update` |
| `cdek_task_outbox` | очередь задач автоотправки СДЭК: retry/backoff, статус обработки, последняя ошибка |
| `delivery_test_attempts` | общий между инстансами rate-limit «Проверить связь» |

`orders.delivery_method` (`cdek_pickup`), `delivery_carrier` и поля ПВЗ —
нейтральный snapshot. Режим доставки даёт единый резолвер `resolveDeliveryMode()`:
`disabled` (заказ без ПВЗ при аварийном `DELIVERY_ENABLED=false` или отсутствии
активного перевозчика), `pickup_required` (выбор ПВЗ СДЭК) или `error`→503
(fail closed: включённый, но неисправный перевозчик/нечитаемые настройки не
деградируют в «заказ без ПВЗ»).
Создание заказа берёт locked snapshot настроек (`FOR SHARE`) и повторно подтверждает
ПВЗ у провайдера. Секреты перевозчика управляются в админке и хранятся
шифрованными (мастер-ключ `SETTINGS_ENC_KEY` только в `.env`). Исторически
перевозчик-модель расширялась мульти-carrier миграциями `005`/`006`, но рантайм
Ozon позже снят миграцией `013_drop_ozon.sql`.

---

## Статус реализации

Единый источник статуса фаз — [ROADMAP.md](ROADMAP.md). Здесь не дублируется,
чтобы не расходиться. Известный техдолг — [docs/tech-debt.md](docs/tech-debt.md).

> ResultURL/SuccessURL/FailURL и фактический `.env` прода описаны в
> `docs/environments.md`. Робокасса — в боевом режиме с 2026-06-21
> (`ROBOKASSA_TEST_MODE=false`), подпись SHA-256 с 2026-06-23; реальные оплаты
> проходят.

---

## Интеграция с Робокассой

Процесс оплаты:

```
1. Покупатель нажимает «Оплатить»
        ↓
2. POST /api/robokassa/init
   — создаёт заказ в БД со статусом pending
   — считает подпись: hash(Login:OutSum:InvId:Password1), алгоритм — ROBOKASSA_HASH_ALGO
     (на проде SHA-256, синхронно с ЛК; в тестах/легаси — MD5)
   — редиректит на https://auth.robokassa.ru/Merchant/Index.aspx
        ↓
3. Робокасса проводит оплату
        ↓
4. GET или POST /api/robokassa/result  ← сервер Робокассы → наш сервер
   — проверяет подпись: hash(OutSum:InvId:Password2)
   — сверяет OutSum с total_kopecks заказа (защита от недоплаты)
   — атомарно меняет `pending/awaiting_payment` → `paid/new` (идемпотентно)
   — возвращает "OK{InvId}"
        ↓
5. GET /api/robokassa/success  ← редирект покупателя на /order/<token>
   — статус «оплачено» берётся из БД, не из query-параметра
   — токен отдаётся только доказуемому покупателю: order-ref cookie этого браузера
     (ставится в init и /api/robokassa/pay) либо валидная подпись OutSum:InvId:Password1;
     иначе редирект на /. FailURL приходит без подписи — там работает только cookie.
```

Подпись **всегда считается на сервере**. Password1 и Password2 — только в переменных окружения, никогда в коде.

---

## Админ-панель

Защита: вход по паролю (без поля логина) через `iron-session` (зашифрованная cookie,
без JWT). Один пользователь-администратор, пароль в `.env` (`ADMIN_PASSWORD`), ключ
cookie — `SESSION_SECRET`. Сравнение — `timingSafeEqual` SHA-256 digest равной длины,
вход с rate-limit. Страницы `app/admin/(protected)` используют `requireAdminPage()`,
`/api/admin/**` и `/api/upload` — `requireAdminApi()`; изменяющие запросы проходят
same-origin проверку (инвариант **I8**): сверяется **хост** заголовка `Origin` с
`Host` запроса (не полный origin — за прокси `next start` строит `request.url` как
`http://`).

Возможности:
- Список товаров с сортировкой drag-and-drop
- Создать / редактировать товар: название, slug, серия, описание, цена, ароматы, наличие
- Управление витриной: `public` (на витрине) / `unlisted` (скрыт, но покупается по прямой ссылке) / `hidden` (снят)
- Временные скидки с таймером (дата начала/окончания); эффективная цена — на сервере, snapshot в заказ (**I9**). Поле `datetime-local` работает в часовом поясе браузера с точностью до минуты; форма хранит исходный instant и шлёт неизменённый момент как есть (DST-safe), сервер принимает только строгий RFC 3339 с offset
- Загрузить несколько фото, выбрать обложку, переупорядочить, удалить фото — `PATCH/DELETE /images` возвращают полный актуальный `{ images }`, форма заменяет им локальный список
- Удаление из UI по умолчанию — архивирование (`visibility='hidden'`); физическое удаление требует серверной проверки точного названия товара (`confirmationName`)

> **Конкурентная витрина:** любые операции, способные изменить состав или порядок
> публичной витрины (`POST`/`PATCH`/`DELETE` товара и `reorder`), берут единый
> transaction-scoped advisory lock `PRODUCTS_PUBLIC_ORDER_LOCK = 7_903_244_111`
> (`pg_advisory_xact_lock`) ПЕРВЫМ запросом транзакции, до чтения товара/набора
> public. Устаревший `reorder` получает `409`. Любой будущий путь, меняющий
> `visibility`/`sort_order`, обязан брать тот же ключ.
- Список/карточка заказов, отмена неоплаченного заказа и переходы исполнения с аудитом
- Управление доставкой СДЭК: ключи (секрет показывается маской, наружу не отдаётся),
  тариф, «Проверить связь», удаление ключей. Ключи хранятся шифрованными в БД (AES-256-GCM).
- Отдельный блок автоотправки: точка сдачи, отправитель, дефолтные вес/габариты,
  включение автосоздания, регистрация и удаление вебхука СДЭК.

`DELIVERY_ENABLED=false` сохраняется как аварийный global off, но не как основной
продуктовый сценарий. Нормальный запуск доставки гейтится наличием ключей и тарифа,
а fail-closed семантика переводит checkout в `503`, если включённый СДЭК настроен
неполно или не читается. Перенос ключей из `.env` в БД и ротация мастер-ключа —
операционные скрипты `backfill-delivery-credentials.ts` /
`rotate-delivery-settings-key.ts`.

Детальные спецификации — [docs/specs/done/admin-products.md](docs/specs/done/admin-products.md),
[docs/specs/done/admin-products-hardening.md](docs/specs/done/admin-products-hardening.md),
[docs/specs/done/admin-delivery-settings.md](docs/specs/done/admin-delivery-settings.md),
[docs/specs/done/cdek-pvz.md](docs/specs/done/cdek-pvz.md),
[docs/specs/done/cdek-auto-shipment.md](docs/specs/done/cdek-auto-shipment.md).

---

## Хранение файлов

Фото загружаются через `POST /api/upload`, сохраняются в `/public/uploads/products/`. Nginx отдаёт их напрямую, минуя Node.js.

При росте (>50 товаров, много фото) можно переехать на S3-совместимое хранилище (Selectel / Yandex Cloud) без изменения схемы БД — только поменять `filename` на полный URL.

---

## Nginx

```nginx
server {
    listen 443 ssl;
    server_name mavita.ru;

    # SSL — Certbot
    ssl_certificate     /etc/letsencrypt/live/mavita.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mavita.ru/privkey.pem;

    # Загруженные фото — Nginx отдаёт сам, без Node
    location /uploads/ {
        alias /var/www/mavita-repo/shop/public/uploads/;
        expires 30d;
    }

    # Всё остальное — Next.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;   # доверенный IP для rate-limit логина
        proxy_set_header X-Forwarded-Proto $scheme;      # https за прокси
    }
}
```

> `Host` обязателен: на нём держится same-origin проверка админки (**I8**) — Node за
> прокси видит `request.url` как `http://`, поэтому сверяется хост `Host`, а не протокол.

---

## Деплой

Фактический процесс деплоя, отката, backup и применения схемы — в [docs/operations.md](docs/operations.md) (runbook). Параметры стендов, SSH и пути — в [docs/environments.md](docs/environments.md).

Кратко: деплой ручной (rsync `shop/` → VPS → `npm run build` → `pm2 reload mavita`). Автоматизация через GitHub Actions — в плане (Ф5).

---

## Переменные окружения (.env)

Полный список — в `shop/.env.example` (единственный публичный источник, инвариант **I7**). Значения на проде — в [docs/environments.md](docs/environments.md). Ключевые: `DATABASE_URL`, `ROBOKASSA_LOGIN/PASSWORD1/PASSWORD2`, `ROBOKASSA_TEST_MODE`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `NEXT_PUBLIC_BASE_URL`, `DELIVERY_ENABLED`. Доставка: `SETTINGS_ENC_KEY` (мастер-ключ шифрования секретов СДЭК, ровно 32 байта; **потеря = потеря всех ключей**), опц. `CDEK_API_BASE`, `NEXT_PUBLIC_YANDEX_MAPS_API_KEY`. Ключи самого СДЭК теперь в БД шифрованными, не в `.env`. `DELIVERY_ENABLED=false` следует трактовать как аварийное отключение checkout-доставки, а не как норму для пользовательского сценария.

---

## Масштабирование

| Горизонт | Что сделать |
|---|---|
| 5 → 20 товаров | ничего не менять |
| 20 → 100 товаров | добавить категории (таблица `categories`, FK в `products`) |
| Рост трафика | апгрейд до 2 CPU / 8 GB на том же провайдере |
| Много фото | переехать с `/public/uploads` на S3 (один конфиг-флаг) |
