# Архитектура компонентов — МАВИТА Магазин

---

## Sequence-диаграмма флоу оплаты

```mermaid
sequenceDiagram
    autonumber
    actor U as Покупатель
    participant CH as /checkout<br/>(Client)
    participant RI as POST /api/robokassa/init<br/>(Next.js Server)
    participant DB as PostgreSQL
    participant RK as auth.robokassa.ru
    participant RR as POST /api/robokassa/result<br/>(Next.js Server)
    participant SU as GET /api/robokassa/success<br/>(Next.js Server)
    participant FA as GET /api/robokassa/fail<br/>(Next.js Server)
    participant OR as /order/[token]<br/>(RSC)

    U->>CH: Заполняет форму, нажимает «Оплатить»
    CH->>RI: POST {customerName, customerEmail,<br/>customerPhone, expectedTotalKopecks, items}

    RI->>DB: SELECT товары FOR SHARE + settings FOR SHARE
    DB-->>RI: серверный snapshot цен и, при включённой доставке, тарифа

    RI->>DB: INSERT INTO orders (items, delivery, total,<br/>status='pending', fulfillment='awaiting_payment')
    DB-->>RI: order.id

    RI->>DB: INSERT INTO order_items (…) × N позиций
    RI->>DB: UPDATE orders SET inv_id = $1 WHERE id = $1

    RI->>RI: buildPaymentUrl:<br/>sig = MD5(login:outSum:invId:Password1)
    RI-->>CH: {id, paymentUrl}

    CH->>CH: cart.clear()
    CH-->>U: window.location.href = paymentUrl
    U->>RK: GET paymentUrl (редирект браузера)

    Note over RK: Покупатель вводит данные карты

    alt Оплата успешна
        RK->>RR: GET или POST OutSum, InvId, SignatureValue,<br/>+ прочие поля
        RR->>RR: verifyResultSignature:<br/>MD5(OutSum:InvId:Password2) == SignatureValue
        RR->>RR: сверка OutSum с total_kopecks заказа (защита от недоплаты)
        RR->>DB: UPDATE orders SET status='paid', fulfillment='new',<br/>robokassa_data=$1 WHERE id=$2 AND pending/awaiting_payment
        RR-->>RK: 200 «OK{InvId}» (text/plain)

        RK->>SU: GET ?InvId=…&OutSum=…&SignatureValue=…
        SU->>DB: token по InvId
        SU-->>U: 302 → /order/{token}?paid=1

        U->>OR: GET /order/{token}?paid=1
        OR->>DB: SELECT orders + order_items WHERE id=$1
        DB-->>OR: данные заказа
        OR-->>U: «Заказ оплачен» + состав
    else Отмена / ошибка
        RK->>FA: GET ?InvId=…
        FA->>DB: token по InvId
        FA-->>U: 302 → /order/{token}?failed=1
        U->>OR: GET /order/{token}?failed=1
        OR-->>U: «Оплата не прошла» + состав
    end
```

## Пояснения к шагам

| # | Кто → Кто | Метод / тип | Входные данные | Выходные данные | Примечание |
|---|---|---|---|---|---|
| 1 | Покупатель → `/checkout` | UI-событие | Форма: ФИО, email, телефон, корзина из localStorage | — | Корзина читается из `CartProvider` (localStorage) |
| 2 | `/checkout` → `/api/robokassa/init` | `POST JSON` | `{customerName, customerEmail, customerPhone, expectedTotalKopecks, items}`; при включённом СДЭК ещё ПВЗ и expected delivery | — | Клиентские суммы — только optimistic-ожидание; сервер их сверяет |
| 3 | `/api/robokassa/init` → PostgreSQL | транзакция | `slug[]`, при включённой доставке — тариф | заблокированный snapshot | Авторитетный каталог и тариф; цена клиента игнорируется |
| 4 | `/api/robokassa/init` → PostgreSQL | SQL INSERT | customer, items/delivery/total, `pending/awaiting_payment` | `order.id` | Заказ создаётся до редиректа в платёжку |
| 5 | `/api/robokassa/init` → PostgreSQL | SQL INSERT × N | `order_id, product_id, product_name, price_kopecks, quantity` | — | Snapshot цены и названия на момент покупки |
| 6 | `/api/robokassa/init` → PostgreSQL | SQL UPDATE | `inv_id = order.id` | — | У Робокассы `InvId` = `order.id`; поле заполняется сразу |
| 7 | `/api/robokassa/init` внутри | MD5 | `MerchantLogin:OutSum:InvId:Password1` | `SignatureValue` | `Password1` — секрет только на сервере, никогда клиенту |
| 8 | `/api/robokassa/init` → `/checkout` | `201 JSON` | — | `{id, paymentUrl}` | `paymentUrl = null` если Робокасса не сконфигурирована — тогда редирект сразу на `/order/{token}` |
| 9 | `/checkout` | JS | — | — | `cart.clear()` из контекста чистит localStorage |
| 10 | Покупатель → Робокасса | Browser redirect | `paymentUrl` (GET с параметрами + подписью) | — | `window.location.href` — полный переход, не fetch |
| 11 | Робокасса → `/api/robokassa/result` | GET или POST | `OutSum, InvId, SignatureValue` + дополнительные поля | — | **Сервер → сервер**, браузер покупателя не участвует |
| 12 | `/api/robokassa/result` внутри | MD5 verify | `OutSum:InvId:Password2` | `bool` | `Password2` ≠ `Password1` — разные секреты для разных сторон |
| 13 | `/api/robokassa/result` → PostgreSQL | транзакционный UPDATE | `paid/new`, `robokassa_data`, id | — | Переход из `pending/awaiting_payment` идемпотентен и не смешивает оплату с отгрузкой |
| 14 | `/api/robokassa/result` → Робокасса | `200 text/plain` | — | `«OK{InvId}»` | Робокасса ждёт именно эту строку; иначе будет повторять колбэк |
| 15 | Робокасса → `/api/robokassa/success` | `GET` | `InvId, OutSum, SignatureValue` | — | Параллельно с #11, но уже для браузера покупателя |
| 16 | `/api/robokassa/success` → браузер | `302 redirect` | — | `/order/{token}?paid=1` | `?paid=1` — только UX-флаг, не источник правды о статусе |
| 17 | Покупатель → `/order/[token]` | `GET` (RSC) | `id` из URL | — | Страница SSR-читает заказ из БД |
| 18 | `/order/[token]` → PostgreSQL | SQL SELECT | `order.id` | `order + order_items` | Статус отображается из БД — `paid` уже проставлен на шаге #13 |
| — | Робокасса → `/api/robokassa/fail` | `GET` | `InvId` | `302 → /order/{token}?failed=1` | Только при отмене или ошибке оплаты; `status` в БД остаётся `pending` |

---

```mermaid
graph TD
    subgraph Browser["Браузер (Client)"]
        CP[CartProvider\ncontex + localStorage]
        SH[ShopHeader\nлого · корзина · счётчик]
        CB[CartButton\nиконка + badge]
        AB[AddToCartButton\nкнопка «В корзину»]

        subgraph Pages["Страницы (RSC + Client)"]
            PG["/ — Витрина<br/>HomeClient"]
            PP["/product/[slug]<br/>карточка товара"]
            CP2["/cart<br/>состав корзины"]
            CH["/checkout<br/>форма + submit"]
            OR["/order/[token]<br/>статус заказа"]
        end

        CP -->|контекст| SH
        CP -->|контекст| CB
        CP -->|контекст| AB
        CP -->|контекст| CP2
        CP -->|контекст| CH
        SH --> CB
        PG --> AB
        PP --> AB
    end

    subgraph API["API Routes (Next.js / Server)"]
        AP["GET /api/products<br/>список товаров"]
        RI["POST /api/robokassa/init<br/>создать заказ + URL оплаты"]
        RR["GET/POST /api/robokassa/result<br/>сервер→сервер · paid/new"]
        RS["GET /api/robokassa/success<br/>редирект после оплаты"]
        RF["GET /api/robokassa/fail<br/>редирект при ошибке"]
    end

    subgraph Lib["Lib (серверная бизнес-логика)"]
        LO["orders.ts<br/>snapshot товаров/доставки<br/>createOrder · markOrderPaid<br/>getOrder"]
        LR["robokassa.ts<br/>buildPaymentUrl<br/>verifyResultSignature<br/>kopecksToOutSum"]
        LP["products.ts<br/>getProducts · getProduct"]
        LC[catalog.ts]
        LPR["price.ts<br/>formatPrice"]
        DB["db.ts<br/>query · withTransaction<br/>isDbConfigured"]
    end

    subgraph DB_Layer["PostgreSQL 16"]
        T1[("products<br/>product_images")]
        T2[("orders · order_items<br/>store_settings · order_admin_events")]
    end

    subgraph Robokassa["Робокасса"]
        RK["auth.robokassa.ru<br/>Merchant/Index"]
    end

    %% Pages → API
    PG -->|fetch| AP
    CH -->|POST| RI

    %% API → Lib
    AP --> LP
    RI --> LO
    RI --> LR
    RR --> LR
    RR --> LO

    %% Lib → DB
    LP --> DB
    LO --> DB
    DB --> T1
    DB --> T2

    %% Robokassa flow
    RI -->|paymentUrl| Browser
    Browser -->|redirect| RK
    RK -->|POST ResultURL| RR
    RK -->|GET redirect| RS
    RK -->|GET redirect| RF
    RS -->|redirect /order/token| OR
    OR -->|getOrder| LO

    %% Shared lib
    CH --> LPR
    CP2 --> LPR
    LC --> LP
```

## Слои и ответственность

| Слой | Компоненты | Ответственность |
|---|---|---|
| **Browser / Client** | `CartProvider`, `CartButton`, `AddToCartButton`, `ShopHeader` | Состояние корзины в localStorage, UI |
| **Pages (RSC)** | `page.tsx` × 5 | Server-side рендер, получение данных через `lib/` |
| **API Routes** | `/api/products`, `/api/robokassa/*`, `/api/checkout/delivery`, `/api/cdek` | HTTP-граница, валидация ввода, роутинг |
| **Lib** | `orders.ts`, `robokassa.ts`, `catalog.ts`, `products.ts`, `price.ts`, `store-settings.ts` | Бизнес-логика, без HTTP-зависимостей, покрыта тестами |
| **DB** | `db.ts` → PostgreSQL | Персистентность; цены только в копейках (`INTEGER`) |

Пошаговый флоу оплаты — в sequence-диаграмме и таблице выше.

> Диаграммы выше покрывают **публичный флоу покупки**. Админ-панель (Ф4, компонент 1)
> вынесена отдельно ниже.

---

## Админ-панель (Ф4, компонент 1 — реализована)

Защищённый контур управления каталогом. Спецификация — [docs/specs/done/admin-products.md](docs/specs/done/admin-products.md).

| Слой | Компоненты | Ответственность |
|---|---|---|
| **Pages** | `app/admin/login`, `app/admin/(protected)/*` (список, создание, редактирование) | Вход по паролю + UI каталога; `requireAdminPage()`-гард |
| **API Routes** | `app/api/auth/login\|logout`, `app/api/admin/products/**` (CRUD, reorder, images), `app/api/upload` | `requireAdminApi()` + same-origin (**I8**); загрузка фото файл + `product_images` атомарно (**I5**) |
| **Lib** | `auth.ts` (iron-session, гарды, `assertSameOrigin`), `pricing.ts` (эффективная цена/скидка), `catalog.ts` (фильтр видимости), `admin-products-db.ts`, `slug.ts` | Авторизация и серверная бизнес-логика админки |

Инварианты контура: **I8** (гард + same-origin по хосту за прокси, см. `docs/decisions.md`),
**I9** (серверная эффективная цена в snapshot заказа), **I5** (атомарная загрузка фото).

Компонент 2 (заказы, delivery snapshot, **I10**) реализован в репозитории:
`/admin/orders`, `/admin/settings/delivery`, admin API и миграция `003`.
Текущий rollout держит `DELIVERY_ENABLED=false`, поэтому платёжный флоу проверяется
без ПВЗ. Включение СДЭК и OAuth-ключей — отдельный следующий этап:
[docs/specs/done/admin-orders.md](docs/specs/done/admin-orders.md).
