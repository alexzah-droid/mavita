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
│   ├── order/[id]/page.tsx       — страница «заказ принят»
│   │
│   ├── admin/                    — админ-панель (защищена паролем)
│   │   ├── page.tsx              — список товаров
│   │   ├── products/new/         — создать товар
│   │   ├── products/[id]/edit/   — редактировать товар
│   │   └── orders/               — список заказов
│   │
│   └── api/
│       ├── products/             — CRUD товаров
│       ├── upload/               — загрузка фотографий
│       ├── orders/               — создание заказа
│       ├── robokassa/
│       │   ├── init/             — формирование подписи, редирект в Робокассу
│       │   ├── result/           — ResultURL (сервер→сервер, подтверждение оплаты)
│       │   ├── success/          — SuccessURL (редирект покупателя)
│       │   └── fail/             — FailURL
│       └── auth/                 — логин/логаут для админки
│
├── lib/
│   ├── db.ts                     — Postgres-клиент (pg / postgres.js)
│   ├── robokassa.ts              — генерация и проверка MD5-подписи
│   └── auth.ts                   — сессия для админки (iron-session)
│
├── public/
│   └── uploads/                  — загружаемые фото товаров
│       └── products/
│
└── sql/
    └── schema.sql                — DDL для первичного развёртывания
```

---

## База данных

```sql
-- Товары
CREATE TABLE products (
    id                  SERIAL PRIMARY KEY,
    slug                TEXT UNIQUE NOT NULL, -- URL: /product/<slug>
    name                TEXT NOT NULL,
    series              TEXT,
    subtitle            TEXT,
    description         TEXT,
    price_kopecks       INTEGER NOT NULL CHECK (price_kopecks >= 0), -- I2
    scent               TEXT[] NOT NULL DEFAULT '{}',
    in_stock            BOOLEAN NOT NULL DEFAULT true,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    visibility          TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'unlisted', 'hidden')),
    sale_price_kopecks  INTEGER
        CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks >= 0),
    sale_starts_at      TIMESTAMPTZ,
    sale_ends_at        TIMESTAMPTZ,
    CONSTRAINT products_sale_below_price
        CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks < price_kopecks),
    CONSTRAINT products_sale_window
        CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Эффективная цена считается на лету (lib/pricing.ts), без фоновых задач:
-- по истечении sale_ends_at цена автоматически возвращается к price_kopecks.

-- Фотографии товара (одна карточка — несколько фото)
CREATE TABLE product_images (
    id          SERIAL PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,             -- хранится в /public/uploads/products/
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_cover    BOOLEAN NOT NULL DEFAULT false -- главное фото для витрины
);
-- Не более одной обложки на товар; application гарантирует ровно одну, если фото есть.
CREATE UNIQUE INDEX uq_product_cover ON product_images (product_id) WHERE is_cover;

-- Заказы
CREATE TABLE orders (
    id              SERIAL PRIMARY KEY,
    token           TEXT UNIQUE NOT NULL,  -- неугадываемый id для URL /order/<token>
    inv_id          INTEGER UNIQUE,        -- InvId для Робокассы (= id)
    customer_name   TEXT NOT NULL,
    customer_email  TEXT NOT NULL,
    customer_phone  TEXT,
    total_kopecks   INTEGER NOT NULL,
    status          TEXT DEFAULT 'pending',
    -- статусы: pending | paid | cancelled
    robokassa_data  JSONB,                 -- сырой ответ от Робокассы
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Состав заказа
CREATE TABLE order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    product_id  INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,            -- snapshot на момент заказа
    price_kopecks INTEGER NOT NULL,        -- snapshot цены
    quantity    INTEGER NOT NULL DEFAULT 1
);
```

---

## Статус реализации

Единый источник статуса фаз — [ROADMAP.md](ROADMAP.md). Здесь не дублируется,
чтобы не расходиться. Известный техдолг — [docs/tech-debt.md](docs/tech-debt.md).

> **Ф3:** ResultURL/SuccessURL/FailURL нужно прописать в ЛК Робокассы после деплоя на VPS.
> В тестовом режиме в `.env` кладутся тестовые Password1/Password2 (см. `.env.example`).

---

## Интеграция с Робокассой

Процесс оплаты:

```
1. Покупатель нажимает «Оплатить»
        ↓
2. POST /api/robokassa/init
   — создаёт заказ в БД со статусом pending
   — считает подпись: MD5(Login:OutSum:InvId:Password1)
   — редиректит на https://auth.robokassa.ru/Merchant/Index.aspx
        ↓
3. Робокасса проводит оплату
        ↓
4. POST /api/robokassa/result  ← сервер Робокассы → наш сервер
   — проверяет подпись: MD5(OutSum:InvId:Password2)
   — сверяет OutSum с total_kopecks заказа (защита от недоплаты)
   — меняет статус заказа на paid (идемпотентно)
   — возвращает "OK{InvId}"
        ↓
5. GET /api/robokassa/success  ← редирект покупателя на /order/<token>
   — статус «оплачено» берётся из БД, не из query-параметра
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
- Временные скидки с таймером (дата начала/окончания); эффективная цена — на сервере, snapshot в заказ (**I9**)
- Загрузить несколько фото, выбрать обложку, удалить фото
- Список заказов с фильтром по статусу

Детальная спецификация первого компонента — [docs/specs/admin-products.md](docs/specs/admin-products.md).

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
        alias /var/www/mavita/public/uploads/;
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

> `Host` обязателен: на нём держится same-origin проверка админки (**I8**) — Node за
> прокси видит `request.url` как `http://`, поэтому сверяется хост `Host`, а не протокол.
```

---

## Деплой

Фактический процесс деплоя, отката, backup и применения схемы — в [docs/operations.md](docs/operations.md) (runbook). Параметры стендов, SSH и пути — в [docs/environments.md](docs/environments.md).

Кратко: деплой ручной (rsync `shop/` → VPS → `npm run build` → `pm2 reload mavita`). Автоматизация через GitHub Actions — в плане (Ф5).

---

## Переменные окружения (.env)

Полный список — в `shop/.env.example` (единственный публичный источник, инвариант **I7**). Значения на проде — в [docs/environments.md](docs/environments.md). Ключевые: `DATABASE_URL`, `ROBOKASSA_LOGIN/PASSWORD1/PASSWORD2`, `ROBOKASSA_TEST_MODE`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `NEXT_PUBLIC_BASE_URL`.

---

## Масштабирование

| Горизонт | Что сделать |
|---|---|
| 5 → 20 товаров | ничего не менять |
| 20 → 100 товаров | добавить категории (таблица `categories`, FK в `products`) |
| Рост трафика | апгрейд до 2 CPU / 8 GB на том же провайдере |
| Много фото | переехать с `/public/uploads` на S3 (один конфиг-флаг) |
