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
│   │   └── settings/delivery/    — тариф СДЭК до ПВЗ
│   │
│   └── api/
│       ├── products/             — публичный каталог (GET)
│       ├── admin/                — CRUD товаров, заказы и настройки (admin-only)
│       ├── upload/               — загрузка фотографий
│       ├── cdek/                 — поиск ПВЗ через серверный OAuth-прокси
│       ├── checkout/delivery/    — публичный тариф / признак доступности доставки
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
│   └── orders.ts                 — snapshot заказа, оплаты и delivery
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
| `products` | `price_kopecks INTEGER`, visibility, окно скидки, `updated_at`; эффективная цена считается в `lib/pricing.ts` |
| `product_images` | несколько фото, единственная обложка на товар через partial unique index |
| `orders` | неугадываемый `token`, `inv_id`, `items_kopecks + delivery_kopecks = total_kopecks`, payment status и отдельный fulfillment status |
| `order_items` | snapshot названия, цены и количества позиции |
| `store_settings` | единственный фиксированный тариф СДЭК; `0` — явная бесплатная доставка |
| `order_admin_events` | неизменяемый аудит отмены и переходов исполнения |

`orders.delivery_method`, `delivery_carrier` и поля ПВЗ — нейтральный snapshot.
При `DELIVERY_ENABLED=false` новый заказ не содержит ПВЗ и имеет
`delivery_kopecks=0`; это режим текущего rollout. Включённая доставка требует
подтверждённого ПВЗ и серверной повторной проверки через CDEK API.

---

## Статус реализации

Единый источник статуса фаз — [ROADMAP.md](ROADMAP.md). Здесь не дублируется,
чтобы не расходиться. Известный техдолг — [docs/tech-debt.md](docs/tech-debt.md).

> ResultURL/SuccessURL/FailURL уже описаны в `docs/environments.md`. Перед
> реальным платежом проверить на VPS конкретный режим `ROBOKASSA_TEST_MODE` и
> прохождение ResultURL; не считать значение режима подтверждённым только по
> этому документу.

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
4. GET или POST /api/robokassa/result  ← сервер Робокассы → наш сервер
   — проверяет подпись: MD5(OutSum:InvId:Password2)
   — сверяет OutSum с total_kopecks заказа (защита от недоплаты)
   — атомарно меняет `pending/awaiting_payment` → `paid/new` (идемпотентно)
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
- Список/карточка заказов, отмена неоплаченного заказа и переходы исполнения с аудитом
- Настройка фиксированного тарифа доставки

Код СДЭК реализован, однако в текущем rollout отключён `DELIVERY_ENABLED=false`:
поля ПВЗ не показываются и не обязательны. Включение требует отдельной внешней
интеграции и CDEK OAuth-учётных данных.

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

Полный список — в `shop/.env.example` (единственный публичный источник, инвариант **I7**). Значения на проде — в [docs/environments.md](docs/environments.md). Ключевые: `DATABASE_URL`, `ROBOKASSA_LOGIN/PASSWORD1/PASSWORD2`, `ROBOKASSA_TEST_MODE`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `NEXT_PUBLIC_BASE_URL`, `DELIVERY_ENABLED`; CDEK-секреты нужны только после отдельного включения доставки.

---

## Масштабирование

| Горизонт | Что сделать |
|---|---|
| 5 → 20 товаров | ничего не менять |
| 20 → 100 товаров | добавить категории (таблица `categories`, FK в `products`) |
| Рост трафика | апгрейд до 2 CPU / 8 GB на том же провайдере |
| Много фото | переехать с `/public/uploads` на S3 (один конфиг-флаг) |
