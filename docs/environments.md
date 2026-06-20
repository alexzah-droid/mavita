# МАВИТА-ШОП environments

Дата актуализации: 2026-06-21.

## Стенды

| Термин | URL | Где живёт | Деплой |
| --- | --- | --- | --- |
| **локальный** | `http://localhost:3000` | машина разработчика | `npm run dev` |
| **тестовый** | `http://147.45.72.20:4000` (работает) | VPS `147.45.72.20` | Docker, rsync + rebuild |
| **production** | `https://mavita.ru` | выделенный VPS `45.130.147.108` | rsync → `npm run build` → `pm2 reload mavita` |

---

## Тестовый стенд — VPS `147.45.72.20`

**Это общий VPS** — на нём уже работают `invoice-lifecycle` (порты 3000, 3001)
и `uptime-kuma` (порт **3002**). МАВИТА-ШОП развёрнут рядом **в Docker** на порту **4000**.

| Параметр | Значение |
| --- | --- |
| IP | `147.45.72.20` |
| ОС | Ubuntu 24.04 |
| SSH alias | `invoice-vps` (из `~/.ssh/config`) |
| SSH ключ | `~/.ssh/invoice_vps_ed25519` |
| Прямой доступ | `ssh root@147.45.72.20 -i ~/.ssh/invoice_vps_ed25519` |
| Nginx | системный, vhosts в `/etc/nginx/sites-enabled/` |
| Соседи | `invoice-lifecycle` (3000/3001), `uptime-kuma` (3002) |

### Фактическое размещение МАВИТА-ШОП (развёрнут 2026-06-20)

Развёрнут **в Docker** (как у соседей), а не PM2 — первоначальный план
«PM2 + /var/www/mavita + порт 3002» **не использован**.

```
/opt/mavita-shop/             — код Next.js (синхронизируется rsync с локальной shop/)
docker network: mavita-net    — общая сеть app ↔ db
container mavita-shop         — Next.js, порт 4000→3000, restart unless-stopped
container mavita-db           — PostgreSQL 16-alpine, том mavita-pgdata
secret /root/mavita_db_password.txt   — пароль БД (ВНЕ synced-каталога!)
```

| Параметр | Значение |
| --- | --- |
| Порт приложения | **4000** (`0.0.0.0:4000`; Docker обходит UFW, порт открыт снаружи) |
| Прямой доступ | `http://147.45.72.20:4000/` |
| `DATABASE_URL` | `postgresql://mavita:<secret>@mavita-db:5432/mavita` (через `docker run -e`) |
| Данные БД | том `mavita-pgdata`; схема+seed применены из `/opt/mavita-shop/sql/` |

> ⚠️ Порт **3002 — это uptime-kuma**, а не МАВИТА (вопреки прежним заметкам). МАВИТА слушает **4000**.
>
> ⚠️ `rsync --delete` затирает в `/opt/mavita-shop/` файлы, которых нет в локальной `shop/`.
> Поэтому секрет БД хранится в `/root/`, а не внутри каталога деплоя.

### Редеплой тестового стенда

```bash
# 1) синхронизировать код (секреты/артефакты исключены)
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env*' --exclude tsconfig.tsbuildinfo \
  -e "ssh -i ~/.ssh/invoice_vps_ed25519" \
  shop/ root@147.45.72.20:/opt/mavita-shop/

# 2) на сервере — пересобрать образ и заменить контейнер
ssh invoice-vps
DBPASS=$(cat /root/mavita_db_password.txt)
cd /opt/mavita-shop && docker build -t mavita-shop:latest .
docker rm -f mavita-shop
docker run -d --name mavita-shop --restart unless-stopped --network mavita-net \
  -p 4000:3000 -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 \
  -e DATABASE_URL="postgresql://mavita:${DBPASS}@mavita-db:5432/mavita" \
  -e NEXT_PUBLIC_BASE_URL="https://mavita.alexzah.ru" \
  mavita-shop:latest

# применить схему/seed (идемпотентно):
docker exec -i mavita-db psql -U mavita -d mavita < /opt/mavita-shop/sql/schema.sql
docker exec -i mavita-db psql -U mavita -d mavita < /opt/mavita-shop/sql/seed.sql
```

### nginx / домен — НЕ активны

Vhost `/etc/nginx/sites-enabled/mavita` — заглушка под `mavita.alexzah.ru`
(только redirect 80→443 + acme-challenge, без `proxy_pass` и 443-блока). DNS
`mavita.alexzah.ru` не резолвится (SERVFAIL), SSL не выпускался. До настройки DNS
тест доступен только по `http://147.45.72.20:4000/`.

---

## Production-стенд — выделенный VPS `45.130.147.108`

Отдельный VPS под продакшн `mavita.ru` (домен и хостинг куплены 2026-06-20).
В отличие от тестового — здесь **только МАВИТА**, ничего постороннего.

| Параметр | Значение |
| --- | --- |
| IP | `45.130.147.108` |
| Домен | `mavita.ru` (+ `www.mavita.ru`) |
| ОС | Ubuntu 22.04.5 LTS |
| Ресурсы | 1 vCPU / 1 GB RAM / 10 GB NVMe + 2 GB swap |
| SSH alias | `mavita` (из `~/.ssh/config`) |
| SSH ключ | `~/.ssh/mavita_ed25519` |
| Прямой доступ | `ssh root@45.130.147.108 -i ~/.ssh/mavita_ed25519` |

### Установленный стек (готов 2026-06-20)

| Компонент | Версия | Примечание |
| --- | --- | --- |
| Node.js | 20.20.2 | NodeSource |
| npm | 10.8.2 | |
| PM2 | 7.0.1 | `systemctl enable pm2-root` включён |
| PostgreSQL | 16.14 | PGDG-репозиторий, autostart |
| Nginx | 1.18.0 | reverse proxy → `127.0.0.1:3000` |
| Certbot | 1.21.0 | SSL выпущен: `mavita.ru` + `www.mavita.ru`, истекает 2026-09-17 |
| UFW | active | разрешены OpenSSH + Nginx Full (22/80/443) |
| Timezone | Europe/Moscow | |

### Размещение (фактическое, после первого деплоя 2026-06-20)

```
/var/www/mavita-repo/                     — git-клон репозитория (полный)
/var/www/mavita-repo/shop/                — каталог Next.js-приложения (cwd PM2)
/var/www/mavita-repo/shop/.env            — секреты, chmod 600 (НЕ в git)
/var/www/mavita-repo/shop/public/uploads/ — фото товаров (Nginx отдаёт напрямую)
/etc/nginx/sites-available/mavita.ru      — vhost (symlink в sites-enabled)
```

> ⚠️ `/var/www/mavita/` также существует на сервере — это артефакт первоначального
> провижининга (там свой `.env`). PM2 его **не использует**. Рабочий каталог — только
> `/var/www/mavita-repo/shop/`.

**Порт приложения: `3000`**.

### PM2

```
pm2 show mavita    → script: /usr/bin/npm, args: start, cwd: /var/www/mavita-repo/shop
```

### БД

- База `mavita`, владелец `mavita`, 4 таблицы из `sql/schema.sql` — ✅ применены (2026-06-20).
- `DATABASE_URL` прописан в `.env`.
- Seed-данные загружены через psql вручную.

### .env на сервере (`/var/www/mavita-repo/shop/.env`)

| Переменная | Статус |
| --- | --- |
| `DATABASE_URL` | ✅ заполнен |
| `ROBOKASSA_LOGIN` | ✅ `mavita` |
| `ROBOKASSA_PASSWORD1` | ✅ заполнен |
| `ROBOKASSA_PASSWORD2` | ✅ заполнен |
| `ROBOKASSA_TEST_MODE` | состояние проверять после rollout; переключение на `false` — Пауза 1 |
| `ADMIN_PASSWORD` | ✅ заполнен |
| `SESSION_SECRET` | ✅ заполнен |
| `NEXT_PUBLIC_BASE_URL` | `https://mavita.ru` |
| `DELIVERY_ENABLED` | `false` для текущего rollout: заказ без ПВЗ/доставки |
| `CDEK_CLIENT_ID` / `CDEK_CLIENT_SECRET` | не требуются и не заполняются, пока доставка выключена |

### Деплой (текущий процесс)

```bash
# локально
rsync -avz --exclude='.env' --exclude='node_modules' --exclude='.next' --exclude='public/uploads' \
  shop/ mavita:/var/www/mavita-repo/shop/

# на VPS
ssh mavita "cd /var/www/mavita-repo/shop && npm run build && pm2 reload mavita --update-env"
```

### Настройки Робокассы в ЛК (прописаны 2026-06-20)

| URL | Значение |
| --- | --- |
| ResultURL | `https://mavita.ru/api/robokassa/result` |
| SuccessURL | `https://mavita.ru/api/robokassa/success` |
| FailURL | `https://mavita.ru/api/robokassa/fail` |
| Метод отправки | POST для всех трёх URL |

---

## Инварианты окружений

- `ROBOKASSA_TEST_MODE=true` на тестовом стенде всегда.
- Переключение на `ROBOKASSA_TEST_MODE=false` — **Пауза 1**, только с явного подтверждения.
- Реальные `.env` не коммитятся. `.env.example` — единственный публичный список переменных.
- Не трогать `/opt/invoice-lifecycle/` при деплое МАВИТА — разные сервисы.
- Перед миграциями PostgreSQL: `pg_dump` backup базы `mavita`. `schema.sql` не
  заменяет миграцию `003_orders_delivery_and_admin_events.sql` для существующей БД.
- Любое действие на VPS требует **Паузы 1**.

---

## Где смотреть дальше

- `docs/operations.md` — runbook деплоя и отката
- `.env.example` — список переменных (без значений)
