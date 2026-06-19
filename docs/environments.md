# МАВИТА-ШОП environments

## Стенды

| Термин | URL | Где живёт | Деплой |
| --- | --- | --- | --- |
| **локальный** | `http://localhost:3000` | машина разработчика | `npm run dev` |
| **тестовый** | `http://147.45.72.20:4000` (работает) | VPS `147.45.72.20` | Docker, rsync + rebuild |
| **production** | `https://mavita.ru` | выделенный VPS `45.130.147.108` | только после Паузы 1 |

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
| Certbot | 1.21.0 | SSL выпустить после настройки DNS |
| UFW | active | разрешены OpenSSH + Nginx Full (22/80/443) |
| Timezone | Europe/Moscow | |

### Размещение

```
/var/www/mavita/                          — код Next.js
/var/www/mavita/public/uploads/           — фото товаров (Nginx отдаёт напрямую)
/var/www/mavita/.env                       — секреты, chmod 600 (НЕ в git)
/etc/nginx/sites-available/mavita.ru       — vhost (symlink в sites-enabled)
```

**Порт приложения: `3000`** (на этом VPS он свободен, в отличие от тестового).

### БД (создана)

- База `mavita`, владелец — роль `mavita`.
- `DATABASE_URL` прописан в `/var/www/mavita/.env`.
- Схема ещё **не применена** — при первом деплое: `psql ... -f sql/schema.sql`.

### .env на сервере

Создан `/var/www/mavita/.env` (chmod 600) с заполненными `DATABASE_URL`,
`SESSION_SECRET`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_BASE_URL=https://mavita.ru`.
`ROBOKASSA_*` — пустые, `ROBOKASSA_TEST_MODE=true` (регистрация Робокассы ждёт домена).
Сами значения секретов в git не хранятся.

### Осталось сделать (вне настройки сервера)

1. **DNS**: у регистратора mavita.ru добавить `A @ → 45.130.147.108` и `A www → 45.130.147.108`.
2. После propagation DNS: `certbot --nginx -d mavita.ru -d www.mavita.ru` (HTTP→HTTPS редирект).
3. Первый деплой кода из `shop/` → `/var/www/mavita/`, `npm ci && npm run build`, `pm2 start`.
4. Применить `sql/schema.sql`.

---

## Инварианты окружений

- `ROBOKASSA_TEST_MODE=true` на тестовом стенде всегда.
- Переключение на `ROBOKASSA_TEST_MODE=false` — **Пауза 1**, только с явного подтверждения.
- Реальные `.env` не коммитятся. `.env.example` — единственный публичный список переменных.
- Не трогать `/opt/invoice-lifecycle/` при деплое МАВИТА — разные сервисы.
- Перед миграциями PostgreSQL: `pg_dump` backup базы `mavita`.
- Любое действие на VPS требует **Паузы 1**.

---

## Где смотреть дальше

- `docs/operations.md` — runbook деплоя (создать при первом деплое)
- `docs/project-bootstrap/templates/operations.template.md` — шаблон
- `.env.example` — список переменных (создать из шаблона при Ф0)
