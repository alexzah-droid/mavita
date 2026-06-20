# Спецификация: Админка — управление товарами и витриной

Дата: 2026-06-20
Фаза: **Ф4** (админ-панель), первый компонент.
Статус: ✅ реализована и на проде (2026-06-20). Пауза 2 на `iron-session` пройдена —
владелец подтвердил зависимость 2026-06-20 (§13). Правки после деплоя: CSRF-проверка
за прокси (TD-22); ревью реализации 2026-06-21 — инвариант cover (clear-then-set,
TD-23) и распознавание WebP во всех контейнерах (TD-24), см. `docs/tech-debt.md`.

Связанные документы: [architecture.md](../../architecture.md), [PROJECT_CORE.md](../../PROJECT_CORE.md)
(инварианты), [ROADMAP.md](../../ROADMAP.md), [TESTING_PLAN.md](../../TESTING_PLAN.md).

---

## 1. Цель и охват

Дать администратору единый экран для управления каталогом:

0. **Авторизация** входа в админку (`iron-session`), вход/выход, защита всех
   `/admin/**` и `/api/admin/**` — входит в охват этого компонента (см. §2).
1. **CRUD** всех атрибутов товара (название, slug, серия, подзаголовок, описание,
   цена, ароматы, наличие, фото).
2. **Управление витриной** — какие товары видны в каталоге.
3. **Скрытые товары по прямой ссылке** — товар не показывается на витрине, но
   доступен и покупается по `/product/<slug>`.
4. **Временные скидки** — сниженная цена с датой начала/окончания (таймер);
   по истечении цена автоматически возвращается к обычной — без участия человека.
5. **Сортировка** витрины (drag-and-drop, поле `sort_order`).
6. **Фото** — загрузка, выбор обложки, переупорядочивание, удаление.

### Вне охвата (этого компонента)

- Управление заказами (`/admin/orders`) — отдельный компонент Ф4.
- Категории/коллекции, складские остатки числом, промокоды — будущие фазы
  (см. «Масштабирование» в architecture.md). Здесь скидка — только по товару.

---

## 2. Авторизация админа

Все маршруты и страницы из этой спеки **защищены** и недоступны анонимно.
Авторизация реализуется здесь же, в составе компонента.

### 2.1. Модель

Один администратор (architecture.md §«Админ-панель»). Сессия — зашифрованная
cookie через **`iron-session`** (без JWT, без отдельной таблицы пользователей).
Пароль — единственный секрет, хранится в `.env` как `ADMIN_PASSWORD`; ключ
шифрования cookie — `SESSION_SECRET` (≥ 32 символов). Обе переменные уже
зарезервированы в `shop/.env.example` (секция `--- Admin (Ф4) ---`).

> Сравнение пароля — **константное по времени**: сначала SHA-256 от UTF-8 ввода
> и ожидаемого значения, затем `crypto.timingSafeEqual` двух digest одинаковой
> длины. Прямой вызов `timingSafeEqual` на строках разной длины бросает исключение
> и раскрывает длину. Пустые/отсутствующие `ADMIN_PASSWORD` и `SESSION_SECRET`
> запрещены: `assertAuthConfig()` вызывается при старте приложения и до обработки
> логина. Пароль и секрет — только из `env`, никогда в коде/клиенте (как I1 для
> Робокассы).

### 2.2. `lib/auth.ts`

```ts
import type { SessionOptions } from 'iron-session'
import type { NextResponse } from 'next/server'

export type AdminSession = { isAdmin: true; loginAt: number }

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,         // ≥ 32 симв.
  cookieName: 'mavita_admin',
  ttl: 60 * 60 * 8,                              // серверная криптографическая жизнь: 8 ч
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // только HTTPS на проде
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8 - 60,                      // чуть короче ttl
  },
}

/** Бросает конфигурационную ошибку, если секреты отсутствуют или слишком коротки. */
export function assertAuthConfig(): void

/** Чистая, тестируемая: сравнивает SHA-256 digest через timingSafeEqual. */
export function verifyPassword(input: string, expected: string): boolean

/** Возвращает сессию или null; не делает ни redirect, ни HTTP-ответ. */
export async function getAdminSession(): Promise<AdminSession | null>

/** Гард Server Component: при отсутствии сессии делает redirect('/admin/login'). */
export async function requireAdminPage(): Promise<AdminSession>

/** Гард Route Handler: возвращает сессию либо готовый JSON 401. */
export async function requireAdminApi(): Promise<AdminSession | NextResponse>

/** Для изменяющих API: принимает только same-origin POST/PATCH/DELETE. */
export function assertSameOrigin(request: Request): NextResponse | null
```

`requireAdminApi()` вызывается до разбора body и до обращения к БД. Handler обязан
сразу вернуть результат, если это `NextResponse`; так ответ `401` не зависит от
того, кто вызвал гард. `requireAdminPage()` намеренно отдельный: page-layout не
может корректно вернуть API-ответ.

### 2.3. Маршруты входа/выхода

| Метод и путь | Назначение |
| --- | --- |
| `POST /api/auth/login`  | принимает `{ password }`, при успехе пересоздаёт cookie-сессию, `200 { ok: true }`; иначе `401`/`429` |
| `POST /api/auth/logout` | уничтожает текущую сессию, `200 { ok: true }` |

- Логин — **rate-limit**: максимум 5 неуспешных попыток на нормализованный IP за
  скользящие 60 секунд; превышение → `429` и `Retry-After`. Map очищается по
  истечении окна и имеет жёсткий лимит записей. IP берётся из первого значения
  `X-Forwarded-For` только потому, что production Nginx **перезаписывает** его как
  `proxy_set_header X-Forwarded-For $remote_addr` (не `$proxy_add_x_forwarded_for`)
  и Node-порт недоступен извне; это требование добавить в runbook. На локальном запуске используется
  `request.headers.get('x-forwarded-for') ?? 'local'`. Это защита от перебора в
  одном PM2-процессе; при горизонтальном масштабировании заменить её на Redis или
  Nginx `limit_req` с общим лимитом. Лимит Map — 10 000 IP: сперва удаляются
  истёкшие записи, затем самая старая; переполнение не отключает rate-limit.
- `POST /api/auth/login` доступен анонимно, но тоже проходит same-origin проверку.
  `POST /api/auth/logout` может работать без существующей сессии (идемпотентно
  очищает cookie), но также проходит same-origin проверку. Всё `/api/admin/**` —
  за `requireAdminApi()`, а все страницы из
  `app/admin/(protected)/**` — за `requireAdminPage()`.
- Все state-changing admin handlers и `/api/upload` вызывают `assertSameOrigin()`
  после auth; при несовпадении `Origin`/host возвращают `403`. `SameSite=Lax`
  остаётся дополнительной, а не единственной CSRF-защитой.
- При успешном login handler сначала уничтожает любую текущую session, затем
  записывает только `{ isAdmin: true, loginAt: Date.now() }` и сохраняет новую;
  это исключает фиксацию сессии. Ошибки login используют тот же JSON-конверт, что
  §7.1, и не сообщают, отсутствует ли admin password в конфигурации.

### 2.4. Страница логина

`app/admin/login/page.tsx` — минимальная форма (одно поле «пароль», дизайн-токены
brand.md). При успехе — редирект на `/admin`. Логин **не** лежит под защищённым
layout: структура маршрутов обязана быть следующей.

```
app/admin/login/page.tsx
app/admin/(protected)/layout.tsx       // await requireAdminPage()
app/admin/(protected)/page.tsx         // URL: /admin
app/admin/(protected)/products/new/page.tsx
app/admin/(protected)/products/[id]/edit/page.tsx
```

Route group не меняет URL и устраняет невозможное исключение дочерней страницы из
родительского layout. `/api/auth/login`, `/api/auth/logout` и `/admin/login` —
явные исключения из I8.

> **Инвариант I8:** ни один `/api/admin/**`, `/api/upload` и ни одна защищённая
> `/admin/**`-страница не выполняет работу до успешного `requireAdminApi()` /
> `requireAdminPage()`. Исключения: `/api/auth/login`, `/api/auth/logout`,
> `/admin/login`. Пароль/секрет — только в `env`, сравнение — `timingSafeEqual`
> digest одинаковой длины.

---

## 3. Доменная модель

### 3.1. Видимость товара

Текущая схема описывает витрину одним булевым `in_stock`. Этого мало: «нет на
витрине» и «нельзя купить» — разные состояния. Вводим ортогональную пару.

**`visibility`** (новое поле, enum-через-CHECK) — где товар показывается:

| Значение   | На витрине `/` | Прямая ссылка `/product/<slug>` | Можно купить |
| ---------- | :------------: | :-----------------------------: | :----------: |
| `public`   | да             | да                              | да¹          |
| `unlisted` | **нет**        | да                              | да¹          |
| `hidden`   | нет            | **404 / «недоступен»**          | **нет**      |

`public` — дефолт. `unlisted` закрывает требование «не на витрине, но по прямой
ссылке». `hidden` — черновик/снят с продажи (архив без удаления).

**`in_stock`** (существующее поле) — ортогонально: товар показывается/доступен,
но «нет в наличии». ¹ Купить можно только при `in_stock = true`.

> Итог-правило (используется и на витрине, и при оформлении заказа):
> - **в листинге витрины** ⇔ `visibility = 'public'`
> - **карточка по slug доступна** ⇔ `visibility IN ('public','unlisted')`
> - **можно добавить в заказ** ⇔ `visibility IN ('public','unlisted') AND in_stock`

### 3.2. Временная скидка

Скидка живёт на самом товаре (одна активная скидка на товар — для текущей фазы
достаточно). Три новых поля:

- `sale_price_kopecks INTEGER` — сниженная цена в копейках (I2). `NULL` = скидки нет.
- `sale_starts_at TIMESTAMPTZ` — когда скидка включается. `NULL` = «сразу».
- `sale_ends_at TIMESTAMPTZ` — когда выключается (таймер). `NULL` = бессрочно.

**Эффективная цена** на момент `now` — чистая функция (§5):

```
скидка активна ⇔ sale_price_kopecks IS NOT NULL
              AND (sale_starts_at IS NULL OR now >= sale_starts_at)
              AND (sale_ends_at   IS NULL OR now <  sale_ends_at)

effectivePrice = скидка активна ? sale_price_kopecks : price_kopecks
```

Истечение скидки **не требует фоновой задачи**: цена вычисляется на лету при
каждом чтении. По `sale_ends_at` цена «сама» возвращается к обычной.

Ограничения целостности (CHECK): `sale_price_kopecks >= 0`,
`sale_price_kopecks < price_kopecks` (скидка дешевле обычной),
`sale_ends_at > sale_starts_at` когда оба заданы.

---

## 4. Изменения схемы БД — миграция `002`

Прод-БД уже развёрнута (есть заказы), поэтому — `ALTER` + идемпотентная миграция
в стиле `001_order_token.sql`. `schema.sql` обновляется параллельно для свежих
установок.

`shop/sql/migrations/002_admin_visibility_discount.sql`:

```sql
-- Миграция 002 — видимость товара и временные скидки (Ф4, админка товаров)
-- Идемпотентна. Применять ОДИН РАЗ перед деплоем кода админки:
--   psql -U mavita -d mavita -f sql/migrations/002_admin_visibility_discount.sql
BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS visibility TEXT,
  ADD COLUMN IF NOT EXISTS sale_price_kopecks INTEGER,
  ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sale_ends_at   TIMESTAMPTZ;

UPDATE products SET visibility = 'public' WHERE visibility IS NULL;
ALTER TABLE products ALTER COLUMN visibility SET DEFAULT 'public';
ALTER TABLE products ALTER COLUMN visibility SET NOT NULL;

-- Проверяем constraint на КОНКРЕТНОЙ таблице: имя может существовать у другой.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'products'::regclass AND conname = 'products_visibility_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_visibility_check
      CHECK (visibility IN ('public', 'unlisted', 'hidden'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'products'::regclass AND conname = 'products_sale_price_nonnegative') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_price_nonnegative
      CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'products'::regclass AND conname = 'products_sale_below_price') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_below_price
      CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks < price_kopecks);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'products'::regclass AND conname = 'products_sale_window') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_window
      CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at);
  END IF;
END $$;

-- Витрина читает только public — частичный индекс под основной фильтр.
CREATE INDEX IF NOT EXISTS idx_products_public_sort
  ON products (sort_order, id) WHERE visibility = 'public';

-- TD-13: updated_at должен отражать любое изменение из админки.
CREATE OR REPLACE FUNCTION products_set_updated_at()
RETURNS TRIGGER AS $$ BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_set_updated_at ON products;
CREATE TRIGGER trg_products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_set_updated_at();

COMMIT;
```

Бэкофилл видимости выполняется явно, поэтому миграция безопасна и если колонку
успели создать частично раньше. Существующие товары получают `public` и
`NULL`-скидку. `schema.sql` дополняется теми же именованными столбцами/CHECK,
индексом и trigger `updated_at`; миграционный тест запускает `002` дважды на
чистой тестовой БД.

> **Пауза 2** (PROJECT_CORE §2) не требуется: только аддитивные изменения, потерь
> данных нет.

---

## 5. Чистый слой расчёта цены — `lib/pricing.ts`

Новый модуль **без импорта БД** (как `lib/products.ts`), чтобы переиспользовать
логику и на сервере (заказ), и на клиенте (витрина), и в юнит-тестах.

```ts
export type SaleFields = {
  priceKopecks: number
  salePriceKopecks: number | null
  saleStartsAt: string | null   // ISO
  saleEndsAt: string | null     // ISO
}

export type EffectivePrice = {
  kopecks: number            // что реально платит покупатель
  regularKopecks: number     // обычная цена (для зачёркнутой)
  isOnSale: boolean
  endsAt: string | null      // только у активной срочной скидки
}

/** Чистая. now передаётся явно — тестируется без подмены времени. */
export function effectivePrice(p: SaleFields, now: Date): EffectivePrice
```

Правило активности — из §3.2. Это **единственный** источник истины о цене;
ни витрина, ни заказ не считают цену сами. Невалидные входные данные (нецелые или
отрицательные цены, `salePriceKopecks >= priceKopecks`, нераспознаваемая дата,
конец не позже начала) дают обычную цену и `isOnSale=false`: БД/API не должны
порождать такое состояние, но UI не должен показать некорректную скидку.

Все даты API — RFC 3339 с offset, нормализованные при ответе в UTC ISO 8601
(`2026-06-20T12:00:00.000Z`). Поле `datetime-local` преобразуется браузером из
локальной зоны в ISO перед отправкой; UI явно подписывает локальную часовую зону.
Таймер — клиентский компонент: он получает серверное `now` при рендере, тикает раз
в секунду, повторно вызывает `effectivePrice()` и меняет цену как при наступлении,
так и при окончании окна. Серверная цена в заказе остаётся авторитетной.

---

## 6. Изменения data-слоя

### 6.1. `lib/products.ts` — расширить тип `Product`

```ts
export type Visibility = 'public' | 'unlisted' | 'hidden'

export type Product = {
  // ...существующие поля...
  visibility: Visibility
  sale: {                          // null = скидки нет
    priceKopecks: number
    startsAt: string | null
    endsAt: string | null
  } | null
}
```

`mapRowToProduct` дополняется маппингом новых столбцов. Витрина показывает цену
через `effectivePrice()` (зачёркнутая обычная + текущая + таймер до `endsAt`).
`ProductRow` принимает даты от `pg` как `Date | string | null` и нормализует их в
ISO UTC. Seed-товары явно имеют `visibility: 'public'`, `sale: null`.

### 6.2. `lib/catalog.ts` — фильтры видимости

`SELECT_PRODUCT` добавляет `p.visibility, p.sale_price_kopecks, p.sale_starts_at,
p.sale_ends_at`. Публичные выборки фильтруют по §3.1:

- `getProducts()` (листинг витрины): `WHERE p.visibility = 'public'`.
- `getProductBySlug()` (карточка): `WHERE p.slug = $1 AND p.visibility IN ('public','unlisted')`.
  `hidden` → `undefined` → страница отдаёт 404.

Seed допустим **только** когда `DATABASE_URL` отсутствует (локальная разработка,
CI-сборка). Если БД настроена, пустой SELECT означает пустой каталог/`undefined`,
а ошибка БД — `CatalogUnavailable` и HTTP `503`; ни один путь с настроенной БД не
возвращает seed. Иначе скрытый товар с seed-slug снова стал бы доступен.

### 6.3. `lib/orders.ts` — **безопасность оформления заказа** (критично)

Сейчас `fetchCatalog` тянет `slug, name, price_kopecks, in_stock` и не знает ни о
видимости, ни о скидке. Это дыра: после ввода скидки заказ считался бы по обычной
цене, а `hidden`-товар можно было бы купить, подставив slug. Изменения:

1. `fetchCatalog(client, slugs)` выполняется **внутри** транзакции `createOrder` и
   читает `id, visibility, sale_price_kopecks, sale_starts_at, sale_ends_at` вместе
   с существующими полями через `FOR SHARE`. `CatalogItem` хранит `id`, видимость
   и поля скидки.
2. В начале той же транзакции фиксируется `now = new Date()`, затем строятся lines
   и вставляются `orders`/`order_items`. `product_id` вставляется из выбранного
   `CatalogItem.id`, а не повторным SELECT по slug. Редактирование/скрытие/удаление
   выбранного товара ждёт завершения этой транзакции.
3. `buildOrderLines(catalog, items, now)`:
   - отвергает товар с `visibility = 'hidden'` → ошибка «товар недоступен»
     (`public`/`unlisted` — проходят);
   - `priceKopecks` позиции = `effectivePrice(item, now).kopecks`
     (**snapshot скидочной цены** в `order_items.price_kopecks`);
   - проверка `inStock` сохраняется.

Тот же `now`, lines и total возвращаются вызывающему маршруту для подписи
Робокассы. Снапшот в `order_items` уже есть — менять схему заказов не нужно (I2
сохранён). Это определяет «момент создания заказа» как транзакционно
зафиксированный срез, а не как произвольный запрос до транзакции.

> **Инвариант I9:** цена позиции заказа — это `effectivePrice()` на момент
> создания заказа, посчитанная на сервере из БД; клиентская цена игнорируется
> (усиление действующей защиты от подмены цены).

---

## 7. API администратора

Отдельное пространство `app/api/admin/products/**`, чтобы граница авторизации была
явной и публичный `/api/products` не мог отдать скрытые товары. Каждый handler
до body/БД вызывает `requireAdminApi()` (§2); изменяющий handler сразу после него
вызывает `assertSameOrigin()`. Идентификатор — числовой `id` (не `slug`, т.к. slug
редактируется). Цены принимаются/отдаются в копейках (I2).

| Метод и путь | Назначение |
| --- | --- |
| `GET    /api/admin/products` | список **всех** товаров (включая `unlisted`/`hidden`), с флагом активной скидки |
| `POST   /api/admin/products` | создать товар |
| `GET    /api/admin/products/[id]` | один товар со всеми атрибутами (для формы) |
| `PATCH  /api/admin/products/[id]` | частичное обновление любых атрибутов, в т.ч. `visibility` и полей скидки |
| `DELETE /api/admin/products/[id]` | удалить (см. §7.6) |
| `POST   /api/admin/products/reorder` | массовое обновление `sort_order` (drag-and-drop) |
| `POST   /api/upload` | multipart-загрузка и атомарная привязка фото к товару (I5, admin-only) |
| `PATCH  /api/admin/products/[id]/images` | переупорядочить / назначить обложку |
| `DELETE /api/admin/products/[id]/images/[imageId]` | удалить фото |

Фото грузятся единственным маршрутом **`POST /api/upload`**, как требует I5, а не
двумя конкурирующими `upload`/`images` flows. Он также требует admin-сессию и
same-origin, хотя находится вне namespace `/api/admin`.

### 7.1. Контракт ресурсов и ошибок

Во всех JSON API используются camelCase. Успешный single-product ответ:

```ts
type SaleInput = null | {
  priceKopecks: number
  startsAt: string | null // RFC 3339 с offset
  endsAt: string | null
}

type AdminProduct = {
  id: number
  slug: string
  name: string
  series: string | null
  subtitle: string | null
  description: string | null
  priceKopecks: number
  scent: string[]
  inStock: boolean
  visibility: 'public' | 'unlisted' | 'hidden'
  sale: SaleInput
  isSaleActive: boolean
  sortOrder: number
  images: { id: number; filename: string; sortOrder: number; isCover: boolean }[]
  createdAt: string
  updatedAt: string
}
```

- `POST /api/admin/products` принимает обязательные `name`, `slug`,
  `priceKopecks`; опционально все остальные редактируемые поля. Defaults:
  `scent=[]`, `inStock=true`, `visibility='hidden'`, `sale=null`. Создаёт товар
  скрытым, чтобы незаполненная карточка не попала на витрину. Ответ `201` с
  `AdminProduct`.
- `PATCH /api/admin/products/[id]` принимает частичный объект этих же полей.
  Отсутствующее поле не меняется. `sale` — атомарный объект: `null` очищает все
  три DB-поля, полный объект заменяет их все; частичного PATCH полей скидки нет.
  Ответ `200` с `AdminProduct`.
- `GET /api/admin/products` возвращает `{ products: AdminProduct[] }`; можно
  передать `visibility=public|unlisted|hidden|all` (default `all`). Список
  сортируется `sortOrder, id` и содержит `isSaleActive`, рассчитанный сервером с
  единым `now` ответа. `GET /[id]` возвращает `AdminProduct`.
- Некорректный body/валидация → `400` с
  `{ error: { code: 'VALIDATION_ERROR', messages: string[] } }`; неавторизован →
  `401`; неверный Origin → `403`; отсутствующий product/image → `404`; duplicate
  slug или устаревшая сортировка → `409`. Не возвращать детали PostgreSQL клиенту.

### 7.2. Сортировка витрины

`sort_order` имеет смысл только для `public` товаров. `POST
/api/admin/products/reorder` принимает ровно `{ productIds: number[] }` — полный,
уникальный упорядоченный список **всех текущих public ID**. В одной транзакции API
блокирует public-строки, сравнивает множество ID с body и при несовпадении (товар
изменил visibility/создан другим админом) возвращает `409`; затем записывает
`sort_order = 10, 20, ...`. Повтор того же запроса идемпотентен. При переводе
товара в `public` PATCH назначает ему `max(sort_order)+10`; при уходе с витрины
порядок сохраняется, но игнорируется. Админский список показывает DnD только в
фильтре «на витрине».

### 7.3. Фото и инвариант cover

`POST /api/upload` принимает `multipart/form-data`: один `productId` и `files[]`.
До записи он проверяет сессию, Origin, существование продукта, количество файлов,
лимит размера, реальный MIME/декодируемость изображения (`image/jpeg`, `image/png`,
`image/webp`) и генерирует UUID-имя без пользовательского пути. Лимиты: до 10
фото на товар, до 5 MiB и 6000×6000 px на файл.

Распознавание формата и чтение размеров вынесено в чистый модуль `lib/upload-image.ts`
(`detectImageType`, `imageDimensions`, тестируется юнитами без ФС). WebP читается во
всех трёх контейнерах — `VP8 ` (lossy), `VP8L` (lossless) и `VP8X` (extended), —
а не только `VP8X`: иначе обычные WebP от большинства кодировщиков отбивались бы как
«нераспознаваемое изображение».

Файлы сначала попадают во временный каталог на том же volume. В DB-транзакции
создаются строки `product_images`, файлы переименовываются в финальные имена
**до** commit, затем коммитится БД. Ошибка на любом шаге откатывает строки и
удаляет staging/final-файлы компенсирующей операцией; аварийный процесс между
rename и rollback оставляет только безопасный orphan для cleanup-журнала, но не
строку, указывающую на отсутствующий файл. Ответ `201` возвращает добавленные
image DTO. Это реализация I5: нет временных, непривязанных или анонимных загрузок.

`scripts/cleanup-product-uploads.mjs` раз в сутки (cron на VPS) сверяет UUID-файлы
из `public/uploads/products/` с `product_images.filename` и удаляет только
непривязанные файлы старше одного часа. Он не трогает неизвестные имена или свежие
файлы, логирует каждое удаление и является recovery-механизмом после аварийного
падения процесса, а не частью успешного upload path.

`PATCH /api/admin/products/[id]/images` принимает `{ orderedImageIds: number[],
coverImageId: number }`. IDs должны быть полным точным набором фотографий товара;
API в транзакции задаёт порядок и единственный cover. Первый upload автоматически
становится cover. Инвариант приложения: **ровно один cover, если фото есть; ноль,
если фото нет** — partial unique index гарантирует максимум один, сервер
гарантирует минимум. Поскольку `uq_product_cover` проверяется PostgreSQL на каждом
statement, транзакция сперва одним запросом снимает старую обложку
(`SET is_cover = false WHERE product_id = $1 AND is_cover = true`) и только затем
назначает новую в цикле — иначе при перемещении новой cover раньше старой возник бы
временный дубль и ошибка `23505` (TD-23). При DELETE текущей обложки следующая по sort-order становится
cover в той же DB-транзакции. DB-запись удаляется первой; неудачное удаление файла
оставляет безопасный orphan для retry через cleanup job, но не отменяет успешное
удаление товара/фото.

### 7.4. Валидация (чистая, в `lib/products-admin.ts`, тестируется юнитами)

- `name` — непустой, ≤200 символов; `priceKopecks` — целое ≥ 0 (I2, форма
  принимает рубли → `rublesToKopecks`); `slug` — `^[a-z0-9-]{1,100}$`, уникален
  (БД-constraint + понятная ошибка 409 при дубле). `series`/`subtitle` ≤200,
  `description` ≤10 000, до 20 непустых scent-тегов ≤80 символов каждый.
- `visibility ∈ {public, unlisted, hidden}`.
- Скидка: если задана `sale_price_kopecks` — то `< price_kopecks`; окно
  `sale_ends_at > sale_starts_at`, если оба заданы; `sale_ends_at` в прошлом
  допустимо (скидка просто неактивна) — но UI предупреждает.
- Нарушение → `400` с массивом сообщений (как `OrderValidationError`).

### 7.5. Slug

Кнопка «сгенерировать из названия» (транслитерация ru→lat, нижний регистр,
дефисы) в `lib/slug.ts` — чистая функция. Смена slug опубликованного товара рвёт
старые ссылки → UI показывает предупреждение; редирект старого slug — вне охвата.

### 7.6. Удаление

`order_items.product_id` — `ON DELETE SET NULL`, а `product_name`/`price_kopecks`
там уже snapshot, поэтому физическое `DELETE` товара **не ломает историю заказов**.
Операция по умолчанию — **архивация** (`visibility='hidden'`), отдельная от
`DELETE`. Жёсткое `DELETE` требует подтверждение с точным названием товара в UI.
`product_images` удаляются каскадом; для их файлов применяется тот же cleanup
job, что в §7.3. Ошибка ФС не откатывает уже согласованное изменение БД и
видимость orphan-файла публично непредсказуемой не делает.

---

## 8. Страницы админки (UI)

Под `app/admin/(protected)/`, layout вызывает `requireAdminPage()`. Дизайн-токены — из brand.md
(тёмный фон, янтарь/мох, Manrope/Cormorant).

- **`app/admin/page.tsx` — список товаров.** Таблица/карточки: обложка, название,
  цена (с пометкой «скидка активна до …»), бейдж видимости (`на витрине` /
  `по ссылке` / `скрыт`), `in_stock`. Drag-and-drop доступен только в фильтре
  `public` (строки получают `draggable`, ручка `⠿`) и отправляет полный список ID
  в `reorder`; при `409` экран заново получает список и сообщает об изменении
  другим действием. Быстрые тумблеры видимости и наличия (PATCH). Кнопка «Создать».
- **Прямая ссылка на товар.** Для каждого товара с `visibility ∈ {public,
  unlisted}` строка показывает кликабельный гиперлинк на `/product/<slug>` (для
  `unlisted` это и есть единственный способ попасть в карточку) и кнопку
  «копировать» (абсолютный URL через `productUrl(slug, origin)`). У `hidden` ссылки
  нет — выводится пояснение «нет прямой ссылки (товар скрыт)». Форма URL и правило
  доступности — чистый модуль `lib/product-url.ts` (`productPath`, `productUrl`,
  `isAccessibleByLink`, `moveInOrder`), переиспользуемый в юнит-тестах.
- **`app/admin/products/new/` и `app/admin/products/[id]/edit/`** — единая форма:
  - атрибуты: название, slug (+генерация), серия, подзаголовок, описание, цена
    (в рублях, конверсия в копейки на сабмите), ароматы (теги-массив), наличие;
  - **блок «Витрина»**: радио `public / unlisted / hidden` с пояснениями из §3.1;
  - **блок «Скидка»**: цена скидки (рубли), дата-время начала (опц.) и окончания;
    превью «сейчас цена: … (скидка активна/неактивна)» через `effectivePrice`;
    кнопка «убрать скидку» (обнуляет три поля);
  - **фото**: загрузка (multiple) → `/api/upload` с `productId`, превью-сетка,
    выбор обложки (ровно одна, если фото есть), drag-сортировка, удаление.

Клиентский расчёт превью использует тот же `lib/pricing.ts`, что и сервер.

---

## 9. Влияние на публичную часть

- **Витрина `app/page.tsx`**: видит только `public` (фильтр в `getProducts`).
  Карточка цены — зачёркнутая обычная + скидочная + таймер до `sale.endsAt`,
  когда скидка активна.
- **Карточка `app/product/[slug]/page.tsx`**: `public`+`unlisted` открываются;
  `hidden` → `notFound()`. Та же логика цены/таймера.
- **Корзина/оформление**: цена и доступность пересчитываются на сервере (§6.3).
  Если в корзине лежал товар, ставший `hidden`/нет в наличии, — позиция
  отклоняется с понятным сообщением (механизм ошибок `buildOrderLines` уже есть).
- **`GET /api/products`** (публичный) остаётся только-`public`.
- Если настроенная БД недоступна, публичный API ловит `CatalogUnavailable` и
  возвращает `503`, не seed-каталог. Server-rendered страница пробрасывает ошибку в
  `app/error.tsx` и показывает нейтральный экран «каталог временно недоступен»;
  статус этой страницы остаётся стандартным для Next error boundary.

---

## 10. Тестирование (трасса в TESTING_PLAN.md)

Юниты (Vitest, без БД):

- `lib/auth.test.ts` — `assertAuthConfig` (пустые/короткие env отвергаются),
  `verifyPassword`: верный/неверный пароль, разная длина, пустой ввод; сравнение
  digest равной длины через `timingSafeEqual` не бросает.
- `lib/pricing.test.ts` — активна до начала / в окне / после конца / без дат /
  без скидки / скидка ≥ цены не считается активной / невалидные даты; границы
  `>=`/`<`, UTC-нормализация.
- `lib/products-admin.test.ts` — create/PATCH, отличие отсутствующего `sale` от
  `sale:null`, slug-regex, лимиты полей, скидка < цены, окно дат.
- `lib/slug.test.ts` — транслитерация и нормализация.
- `lib/product-url.test.ts` — `productPath`/`productUrl` (склейка origin без двойного
  слэша), `isAccessibleByLink` (hidden → false), `moveInOrder` (перестановка вперёд/
  назад, no-op и выход за границы, отсутствие мутации входа).
- `lib/orders.test.ts` (дополнить) — `hidden` отвергается; цена позиции =
  скидочная при активной скидке; обычная — при истёкшей; снапшот не зависит от
  последующей смены цены.
- `lib/products.test.ts` (дополнить) — маппинг новых столбцов, дефолты для seed.
- `lib/catalog.test.ts` — seed только без `DATABASE_URL`; при настроенной БД
  пустой результат не возвращает seed, hidden остаётся `undefined`, ошибка БД
  даёт `CatalogUnavailable`.

Интеграционные (с тестовой БД, где доступна):

- фильтры видимости в `catalog` (public-листинг, unlisted по slug, hidden → 404);
- авторизация: `login` с верным паролем ставит cookie; неверный → 401;
  rate-limit → 429; `logout` гасит сессию; `/api/admin/**` без cookie → 401,
  `/api/upload` без cookie → 401, неверный Origin → 403; `/admin/**` без cookie
  → редирект на `/admin/login` (I8).
- admin API: создание/обновление/смена видимости/скидки, 409 на дубль slug,
  `sale:null`, идемпотентность `reorder`, 409 на неполный/устаревший набор public
  ID, `updated_at` меняется при PATCH.
- upload: допустимые/недопустимые MIME и размеры, отсутствие orphan-файла и
  строки при ошибке, первая фотография становится cover, удаление cover выбирает
  следующую; cleanup job удаляет только старые UUID-orphan. Миграция `002`
  применяется дважды и создаёт все named CHECK/trigger.
- заказ: параллельный PATCH/DELETE товара блокируется до создания snapshot; итог и
  строки заказа используют один транзакционный срез I9.

Readiness-гейт (PROJECT_CORE §3): `npm run typecheck && npm test && npm run build`.

---

## 11. Чек-лист реализации

1. Авторизация: `lib/auth.ts` (`iron-session`, `assertAuthConfig`, digest-based
   `verifyPassword`, page/API guards, same-origin), `app/api/auth/login|logout`,
   `instrumentation.ts` вызывает `assertAuthConfig()` рядом с payment config;
   route group `app/admin/(protected)`, rate-limit и Nginx header-contract
   (+тесты). Зависит от `iron-session` (Пауза 2, §13).
2. Миграция `002` + правка `schema.sql`: visibility/sale CHECK, индекс и trigger
   `updated_at`; миграционный тест применяет скрипт дважды. Обновить раздел «База
   данных» в architecture.md.
3. `lib/pricing.ts` (+тест).
4. `lib/products.ts`: тип `Product`, `mapRowToProduct`, seed-дефолты (+тест).
5. `lib/catalog.ts`: SELECT и фильтры видимости; seed только без DB, `503` при
   недоступной настроенной БД.
6. `lib/orders.ts`: `fetchCatalog`/`CatalogItem`/`buildOrderLines` — видимость +
   эффективная цена (+тесты) — **security-критично**.
7. `lib/slug.ts`, `lib/products-admin.ts` (валидация) (+тесты).
8. API `app/api/admin/products/**` по контракту §7: CRUD, atomic sale, reorder;
   `POST /api/upload` — auth + same-origin + компенсируемая атомарная загрузка I5;
   `scripts/cleanup-product-uploads.mjs` + ежедневный cron.
9. Страницы `app/admin/(protected)/**` (список, форма, фото); DnD только public,
   cover invariant на каждом фото-действии.
10. Витрина/карточка: отображение скидки и живого таймера, фильтр видимости,
    контролируемый `503` без seed при недоступной БД.
11. Обновить PROJECT_CORE/TESTING_PLAN/architecture/operations: I8/I9, upload,
    Nginx `X-Forwarded-For` contract, cleanup cron и миграция; ROADMAP уже
    отмечает Ф4 как 🚧.

---

## 12. Зафиксированные продуктовые решения

1. По умолчанию товар архивируется (`visibility='hidden'`); жёсткое `DELETE`
   доступно только с подтверждением точного названия. История заказов сохраняется.
2. Бессрочная скидка разрешена: `endsAt=null`, UI показывает «без срока» вместо
   таймера. Одна скидка на товар достаточна для запуска; расписание нескольких
   скидок — будущая фаза.
3. Смена public slug показывает предупреждение; redirect старого slug вне scope.
4. Новый товар создаётся `hidden`; публикация — осознанное отдельное действие.
5. `sort_order` — порядок только витрины (`public`), не внутреннего списка и не
   unlisted/hidden товаров.

## 13. Единственный gate перед началом кода — ПРОЙДЕН

Добавление `iron-session` — новая ключевая зависимость, поэтому по PROJECT_CORE
§2 требовалась **Пауза 2**. **Владелец подтвердил `iron-session` 2026-06-20.**
Обоснование: это уже зафиксированный в architecture.md механизм зашифрованной
cookie-сессии, без новой инфраструктуры и таблицы пользователей. Открытых
продуктовых или технических вопросов в спецификации не осталось — можно начинать
реализацию с п.1 чек-листа (§11): `npm install iron-session` и `lib/auth.ts`.
