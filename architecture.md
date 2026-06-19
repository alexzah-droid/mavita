# Архитектура: интернет-магазин свечей МАВИТА

## Что строим

Интернет-магазин с витриной, корзиной, оплатой через Робокассу и админ-панелью для управления товарами. Всё на одном VPS.

---

## Сервер

| Параметр | Значение |
|---|---|
| ОС | Ubuntu 24.04 |
| CPU | 1 core |
| RAM | 4 GB |
| Диск | 10 GB NVMe |

**Распределение RAM в продакшне:**

| Процесс | Потребление |
|---|---|
| Nginx | ~50 MB |
| Next.js (Node) | ~300 MB |
| PostgreSQL | ~300 MB |
| ОС | ~200 MB |
| Резерв | ~3 150 MB |

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
    id          SERIAL PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,      -- для URL: /product/vanilnaya-svecha
    name        TEXT NOT NULL,
    description TEXT,
    price       INTEGER NOT NULL,          -- в копейках (избегаем float)
    in_stock    BOOLEAN DEFAULT true,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Фотографии товара (одна карточка — несколько фото)
CREATE TABLE product_images (
    id          SERIAL PRIMARY KEY,
    product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,             -- хранится в /public/uploads/products/
    sort_order  INTEGER DEFAULT 0,
    is_cover    BOOLEAN DEFAULT false      -- главное фото для витрины
);

-- Заказы
CREATE TABLE orders (
    id              SERIAL PRIMARY KEY,
    inv_id          INTEGER UNIQUE,        -- InvId для Робокассы
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
   — меняет статус заказа на paid
   — возвращает "OK{InvId}"
        ↓
5. GET /api/robokassa/success  ← редирект покупателя
   — показывает страницу «Заказ оплачен»
```

Подпись **всегда считается на сервере**. Password1 и Password2 — только в переменных окружения, никогда в коде.

---

## Админ-панель

Защита: логин + пароль через `iron-session` (зашифрованная cookie, без JWT). Один пользователь-администратор, пароль в `.env`.

Возможности:
- Список товаров с сортировкой drag-and-drop
- Создать / редактировать товар: название, описание, цена, наличие
- Загрузить несколько фото, выбрать обложку, удалить фото
- Список заказов с фильтром по статусу

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
    }
}
```

---

## Деплой

```
Локально:  git push origin main
                ↓
GitHub Actions:
    - npm ci
    - npm run build  (проверяем что собирается)
    - SSH на сервер
        - git pull
        - npm ci --production
        - npm run build
        - pm2 reload mavita
```

При первом развёртывании:
```bash
# На сервере
git clone <repo> /var/www/mavita
cd /var/www/mavita
cp .env.example .env   # заполнить вручную
psql -U postgres -f sql/schema.sql
npm ci && npm run build
pm2 start npm --name mavita -- start
pm2 save && pm2 startup
```

---

## Переменные окружения (.env)

```env
DATABASE_URL=postgresql://mavita:pass@localhost:5432/mavita

ROBOKASSA_LOGIN=...
ROBOKASSA_PASSWORD1=...
ROBOKASSA_PASSWORD2=...
ROBOKASSA_TEST_MODE=true    # false в продакшне

ADMIN_PASSWORD=...
SESSION_SECRET=...          # 32+ случайных символа

NEXT_PUBLIC_BASE_URL=https://mavita.ru
```

---

## Масштабирование

| Горизонт | Что сделать |
|---|---|
| 5 → 20 товаров | ничего не менять |
| 20 → 100 товаров | добавить категории (таблица `categories`, FK в `products`) |
| Рост трафика | апгрейд до 2 CPU / 8 GB на том же провайдере |
| Много фото | переехать с `/public/uploads` на S3 (один конфиг-флаг) |
