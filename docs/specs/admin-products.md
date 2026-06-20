# Спецификация: Админка — управление товарами и витриной

Дата: 2026-06-20
Фаза: **Ф4** (админ-панель), первый компонент.
Статус: ⬜ не начато.

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

> Сравнение пароля — **константное по времени** (`crypto.timingSafeEqual`), чтобы
> не утекала длина/префикс через тайминг. Пароль и секрет — только из `env`,
> никогда в коде/клиенте (как I1 для Робокассы).

### 2.2. `lib/auth.ts`

```ts
import type { SessionOptions } from 'iron-session'

export type AdminSession = { isAdmin: true; loginAt: number }

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,         // ≥ 32 симв.
  cookieName: 'mavita_admin',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // только HTTPS на проде
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,                           // 8 часов
  },
}

/** Чистая, тестируемая: верна ли попытка входа. timingSafeEqual внутри. */
export function verifyPassword(input: string, expected: string): boolean

/** Возвращает сессию админа (для API: NextResponse 401, для страниц: redirect). */
export async function getAdminSession(): Promise<AdminSession | null>

/** Гард: бросает 401 (API) или редиректит на /admin/login (страница), если нет сессии. */
export async function requireAdmin(): Promise<void>
```

### 2.3. Маршруты входа/выхода

| Метод и путь | Назначение |
| --- | --- |
| `POST /api/auth/login`  | принимает `{ password }`, при успехе ставит cookie-сессию, `200`; иначе `401` |
| `POST /api/auth/logout` | уничтожает сессию, `200` |

- Логин — **rate-limit** по IP (например, не более 5 попыток/мин, in-memory-счётчик),
  чтобы пароль нельзя было брутить; превышение → `429`.
- `POST /api/auth/login` доступен анонимно; всё прочее `/api/admin/**` и
  `/admin/**` (кроме самой страницы логина) — за `requireAdmin()`.

### 2.4. Страница логина

`app/admin/login/page.tsx` — минимальная форма (одно поле «пароль», дизайн-токены
brand.md). При успехе — редирект на `/admin`. Layout `app/admin/layout.tsx`
вызывает `requireAdmin()` и редиректит неавторизованных на `/admin/login`
(саму `login`-страницу из-под гарда исключаем).

> **Инвариант I8:** ни один `/api/admin/**` и ни одна `/admin/**`-страница
> (кроме `/api/auth/login` и `/admin/login`) не выполняет работу до успешного
> `requireAdmin()`. Пароль/секрет — только в `env`, сравнение — `timingSafeEqual`.

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
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'unlisted', 'hidden')),
  ADD COLUMN IF NOT EXISTS sale_price_kopecks INTEGER
    CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks >= 0),
  ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sale_ends_at   TIMESTAMPTZ;

-- Скидка строго дешевле обычной цены и с корректным окном.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_below_price') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_below_price
      CHECK (sale_price_kopecks IS NULL OR sale_price_kopecks < price_kopecks);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_window') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_window
      CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at);
  END IF;
END $$;

-- Витрина читает только public — частичный индекс под основной фильтр.
CREATE INDEX IF NOT EXISTS idx_products_public_sort
  ON products (sort_order, id) WHERE visibility = 'public';

COMMIT;
```

Бэкофилл не нужен: существующие товары получают `visibility='public'` по DEFAULT
и `NULL`-скидку. `schema.sql` дополняется теми же столбцами/CHECK/индексом.

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
  endsAt: string | null      // для таймера на витрине; null = бессрочно
}

/** Чистая. now передаётся явно — тестируется без подмены времени. */
export function effectivePrice(p: SaleFields, now: Date): EffectivePrice
```

Правило активности — из §3.2. Это **единственный** источник истины о цене;
ни витрина, ни заказ не считают цену сами.

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

### 6.2. `lib/catalog.ts` — фильтры видимости

`SELECT_PRODUCT` добавляет `p.visibility, p.sale_price_kopecks, p.sale_starts_at,
p.sale_ends_at`. Публичные выборки фильтруют по §3.1:

- `getProducts()` (листинг витрины): `WHERE p.visibility = 'public'`.
- `getProductBySlug()` (карточка): `WHERE p.slug = $1 AND p.visibility IN ('public','unlisted')`.
  `hidden` → `undefined` → страница отдаёт 404.

Фоллбэк на seed остаётся; seed-товары трактуются как `public`, `sale = null`.

### 6.3. `lib/orders.ts` — **безопасность оформления заказа** (критично)

Сейчас `fetchCatalog` тянет `slug, name, price_kopecks, in_stock` и не знает ни о
видимости, ни о скидке. Это дыра: после ввода скидки заказ считался бы по обычной
цене, а `hidden`-товар можно было бы купить, подставив slug. Изменения:

1. `fetchCatalog` добавляет в SELECT `visibility, sale_price_kopecks,
   sale_starts_at, sale_ends_at`.
2. `CatalogItem` получает `visibility` + поля скидки.
3. `buildOrderLines(catalog, items, now)`:
   - отвергает товар с `visibility = 'hidden'` → ошибка «товар недоступен»
     (`public`/`unlisted` — проходят);
   - `priceKopecks` позиции = `effectivePrice(item, now).kopecks`
     (**snapshot скидочной цены** в `order_items.price_kopecks`);
   - проверка `inStock` сохраняется.

`now` пробрасывается из `createOrder` (`new Date()`), чтобы итог и подпись
Робокассы считались от той же цены, что видел покупатель. Снапшот в `order_items`
уже есть — менять схему заказов не нужно (I2 сохранён).

> **Инвариант-кандидат I9:** цена позиции заказа — это `effectivePrice()` на момент
> создания заказа, посчитанная на сервере из БД; клиентская цена игнорируется
> (усиление действующей защиты от подмены цены).

---

## 7. API администратора

Отдельное пространство `app/api/admin/products/**`, чтобы граница авторизации была
явной и публичный `/api/products` не мог отдать скрытые товары. Каждый handler
первой строкой вызывает `requireAdmin()` (§2). Идентификатор — числовой `id`
(не `slug`, т.к. slug редактируется). Цены принимаются/отдаются в копейках (I2).

| Метод и путь | Назначение |
| --- | --- |
| `GET    /api/admin/products` | список **всех** товаров (включая `unlisted`/`hidden`), с флагом активной скидки |
| `POST   /api/admin/products` | создать товар |
| `GET    /api/admin/products/[id]` | один товар со всеми атрибутами (для формы) |
| `PATCH  /api/admin/products/[id]` | частичное обновление любых атрибутов, в т.ч. `visibility` и полей скидки |
| `DELETE /api/admin/products/[id]` | удалить (см. §7.3) |
| `POST   /api/admin/products/reorder` | массовое обновление `sort_order` (drag-and-drop) |
| `POST   /api/admin/products/[id]/images` | привязать загруженное фото (через `/api/upload`, I5) |
| `PATCH  /api/admin/products/[id]/images` | переупорядочить / назначить обложку |
| `DELETE /api/admin/products/[id]/images/[imageId]` | удалить фото |

### 7.1. Валидация (чистая, в `lib/products-admin.ts`, тестируется юнитами)

- `name` — непустой; `price_kopecks` — целое ≥ 0 (I2, форма принимает рубли →
  `rublesToKopecks`); `slug` — `^[a-z0-9-]+$`, уникален (БД-constraint + понятная
  ошибка 409 при дубле).
- `visibility ∈ {public, unlisted, hidden}`.
- Скидка: если задана `sale_price_kopecks` — то `< price_kopecks`; окно
  `sale_ends_at > sale_starts_at`, если оба заданы; `sale_ends_at` в прошлом
  допустимо (скидка просто неактивна) — но UI предупреждает.
- Нарушение → `400` с массивом сообщений (как `OrderValidationError`).

### 7.2. Slug

Кнопка «сгенерировать из названия» (транслитерация ru→lat, нижний регистр,
дефисы) в `lib/slug.ts` — чистая функция. Смена slug опубликованного товара рвёт
старые ссылки → UI показывает предупреждение; редирект старого slug — вне охвата.

### 7.3. Удаление

`order_items.product_id` — `ON DELETE SET NULL`, а `product_name`/`price_kopecks`
там уже snapshot, поэтому физическое `DELETE` товара **не ломает историю заказов**.
Тем не менее по умолчанию предлагаем **архивацию** (`visibility='hidden'`) как
безопасную операцию; жёсткое `DELETE` — с подтверждением. `product_images`
удаляются каскадом (`ON DELETE CASCADE`); файлы из `/public/uploads/products/`
удаляются в том же запросе (best-effort, ошибка ФС не откатывает БД).

---

## 8. Страницы админки (UI)

Под `app/admin/`, layout вызывает `requireAdmin()`. Дизайн-токены — из brand.md
(тёмный фон, янтарь/мох, Manrope/Cormorant).

- **`app/admin/page.tsx` — список товаров.** Таблица/карточки: обложка, название,
  цена (с пометкой «скидка активна до …»), бейдж видимости (`на витрине` /
  `по ссылке` / `скрыт`), `in_stock`. Drag-and-drop сортировки → `reorder`.
  Быстрые тумблеры видимости и наличия (PATCH). Кнопка «Создать».
- **`app/admin/products/new/` и `app/admin/products/[id]/edit/`** — единая форма:
  - атрибуты: название, slug (+генерация), серия, подзаголовок, описание, цена
    (в рублях, конверсия в копейки на сабмите), ароматы (теги-массив), наличие;
  - **блок «Витрина»**: радио `public / unlisted / hidden` с пояснениями из §3.1;
  - **блок «Скидка»**: цена скидки (рубли), дата-время начала (опц.) и окончания;
    превью «сейчас цена: … (скидка активна/неактивна)» через `effectivePrice`;
    кнопка «убрать скидку» (обнуляет три поля);
  - **фото**: загрузка (multiple) → `/api/upload`, превью-сетка, выбор обложки
    (radio, ровно одна — `uq_product_cover`), drag-сортировка, удаление.

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

---

## 10. Тестирование (трасса в TESTING_PLAN.md)

Юниты (Vitest, без БД):

- `lib/auth.test.ts` — `verifyPassword`: верный/неверный пароль, разная длина,
  пустой ввод; используется `timingSafeEqual` (равная длина не падает).
- `lib/pricing.test.ts` — активна до начала / в окне / после конца / без дат /
  без скидки / скидка ≥ цены не считается активной; границы `>=`/`<`.
- `lib/products-admin.test.ts` — валидация create/update, slug-regex, скидка < цены,
  окно дат.
- `lib/slug.test.ts` — транслитерация и нормализация.
- `lib/orders.test.ts` (дополнить) — `hidden` отвергается; цена позиции =
  скидочная при активной скидке; обычная — при истёкшей; снапшот не зависит от
  последующей смены цены.
- `lib/products.test.ts` (дополнить) — маппинг новых столбцов, дефолты для seed.

Интеграционные (с тестовой БД, где доступна):

- фильтры видимости в `catalog` (public-листинг, unlisted по slug, hidden → 404);
- авторизация: `login` с верным паролем ставит cookie; неверный → 401;
  rate-limit → 429; `logout` гасит сессию; `/api/admin/**` без cookie → 401,
  `/admin/**` без cookie → редирект на `/admin/login` (I8).
- admin API: создание/обновление/смена видимости/скидки, 409 на дубль slug,
  идемпотентность `reorder`.

Readiness-гейт (PROJECT_CORE §3): `npm run typecheck && npm test && npm run build`.

---

## 11. Чек-лист реализации

1. Авторизация: `lib/auth.ts` (iron-session, `verifyPassword`, `requireAdmin`),
   `app/api/auth/login|logout`, `app/admin/login/`, `app/admin/layout.tsx`-гард,
   rate-limit (+тесты). Зависит от `iron-session` (новая зависимость, Пауза 2 —
   уточнить, см. §12).
2. Миграция `002` + правка `schema.sql`; обновить раздел «База данных» в
   architecture.md (новые поля).
3. `lib/pricing.ts` (+тест).
4. `lib/products.ts`: тип `Product`, `mapRowToProduct`, seed-дефолты (+тест).
5. `lib/catalog.ts`: SELECT и фильтры видимости.
6. `lib/orders.ts`: `fetchCatalog`/`CatalogItem`/`buildOrderLines` — видимость +
   эффективная цена (+тесты) — **security-критично**.
7. `lib/slug.ts`, `lib/products-admin.ts` (валидация) (+тесты).
8. API `app/api/admin/products/**` за `requireAdmin()`.
9. Страницы `app/admin/**` (список, форма, фото).
10. Витрина/карточка: отображение скидки и таймера, фильтр видимости.
11. Зафиксировать I8/I9 в PROJECT_CORE §5; обновить ROADMAP (Ф4 → 🚧) и
    DOCS.md (ссылка на эту спеку).

---

## 12. Открытые вопросы (к владельцу)

1. **Удаление**: по умолчанию архивировать (`hidden`) или разрешать жёсткое
   `DELETE`? (рекомендация: архивация по умолчанию, жёсткое — с подтверждением).
2. **Бессрочная скидка** (без `sale_ends_at`) — разрешаем или требование «таймер»
   делает дату окончания обязательной? (рекомендация: разрешить, но в UI выделять
   как «без срока»).
3. **Несколько скидок/расписание** на товар — сейчас одна. Достаточно для запуска?
4. Нужен ли **редирект старого slug** при переименовании, или достаточно
   предупреждения? (рекомендация: предупреждение, редиректы — позже).
5. **Зависимость `iron-session`** (Пауза 2 — новая внешняя зависимость).
   Архитектура уже называет её как выбранный механизм сессии; подтвердить
   добавление в `shop/package.json`. (рекомендация: да, это и есть план Ф4).
