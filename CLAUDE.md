# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что в репозитории

Два независимых продукта под брендом МАВИТА:

1. **КП-материалы** — статические файлы коммерческого предложения (уже готовы)
2. **Интернет-магазин свечей** — Next.js-приложение с админкой и Робокассой (в разработке)

Полная архитектура магазина описана в [architecture.md](architecture.md). Описание бренда — в [brand.md](brand.md).

---

## КП-материалы (статика)

**Не редактировать вручную:**
- `index.html` — бандлированный файл (~6 MB), сгенерирован кастомным бандлером. Все ассеты встроены как base64 в `<script type="__bundler/manifest">` и `<script type="__bundler/template">`. Runtime-загрузчик разворачивает их через `DecompressionStream` и blob URL.

**Можно редактировать напрямую:**
- `archive/Мавита - четыре направления (один файл).html` — многостраничная HTML-презентация четырёх направлений бизнеса. Использует Google Fonts (Cormorant Garamond + Manrope) с CDN.

Просмотр:
```bash
python3 -m http.server 8080
```

---

## Магазин — стек и запуск

```
Next.js 15 (App Router) + PostgreSQL 16 + Nginx + PM2
```

```bash
npm run dev        # dev-сервер на :3000
npm run build      # production-сборка
npm run start      # запуск production-сборки локально
```

Перед первым запуском:
```bash
cp .env.example .env   # заполнить переменные
psql -U postgres -f sql/schema.sql
npm install
```

---

## Архитектура магазина

### Ключевые принципы

- **Нет отдельного бэкенда** — Next.js API Routes покрывают всю серверную логику
- **Цены в копейках** — поле `INTEGER`, не `FLOAT`, исключает проблемы с округлением
- **Подпись Робокассы** — считается только на сервере в `lib/robokassa.ts`, никогда на клиенте

### Слои приложения

```
app/(shop)/          — публичная витрина (SSR)
app/admin/           — админ-панель (защищена iron-session)
app/api/             — API: товары, загрузка файлов, заказы, Робокасса
lib/                 — db.ts, robokassa.ts, auth.ts
sql/schema.sql       — DDL, применяется один раз при развёртывании
public/uploads/      — загружаемые фото товаров (Nginx отдаёт напрямую)
```

### Таблицы БД

| Таблица | Назначение |
|---|---|
| `products` | товары: slug, name, price (копейки), in_stock, sort_order, visibility (`public`/`unlisted`/`hidden`), поля скидки (`sale_price_kopecks`, `sale_starts_at`, `sale_ends_at`) |
| `product_images` | фото товара; `is_cover` — главное на витрине |
| `orders` | заказ: статус `pending → paid → cancelled`, `token` для URL, `inv_id` для Робокассы |
| `order_items` | состав заказа — snapshot названия и цены на момент покупки |

### Флоу оплаты

```
POST /api/robokassa/init     — создаёт заказ (pending), считает подпись, ставит order-ref cookie, отдаёт paymentUrl
GET  /api/robokassa/pay      — повторная оплата pending-заказа: строит paymentUrl, ставит cookie, редирект в Робокассу
POST /api/robokassa/result   — сервер→сервер: проверяет подпись (Password2), ставит paid, отвечает "OK{InvId}"
GET  /api/robokassa/success  — редирект покупателя на /order/<token> ТОЛЬКО при order-ref cookie или валидной подписи (Password1)
GET  /api/robokassa/fail     — редирект при отмене/ошибке; только по order-ref cookie (FailURL Робокасса не подписывает)
```

Success/fail не отдают токен заказа по голому InvId: InvId — перебираемое число, а
/order/<token> содержит PII. Владельца доказывает order-ref cookie (`lib/order-ref-cookie.ts`).

### Переменные окружения

Полный список — в `shop/.env.example` (единственный публичный источник). Значения на стендах — в [docs/environments.md](docs/environments.md).

---

## Дизайн-система

Общая для КП и магазина:

| Токен | Значение |
|---|---|
| Фон | `#1c1812` / `#221c14` |
| Текст / бумага | `#efe5cf` |
| Акцент (янтарь) | `#d28a55` / `#b7704a` |
| Акцент (мох) | `#a8c478` |
| Основной шрифт | Manrope 300/400/500 |
| Заголовочный | Cormorant Garamond 400/500 |

---

## Деплой

`.nojekyll` — сайт публикуется через GitHub Pages (КП-материалы).

Магазин деплоится на VPS `45.130.147.108` (Ubuntu 22.04, `mavita.ru`). Код живёт в `/var/www/mavita-repo/shop/` (PM2 cwd). Деплой ручной: rsync `shop/` → VPS → `npm run build` → `pm2 reload mavita --update-env`. Nginx — reverse proxy на порт 3000, SSL через Certbot. GitHub Actions — в плане.

Команды деплоя, отката и backup — в [docs/operations.md](docs/operations.md); параметры стендов и SSH — в [docs/environments.md](docs/environments.md).
