# МАВИТА-ШОП environments

## Стенды

| Термин | URL | Где живёт | Деплой |
| --- | --- | --- | --- |
| **локальный** | `http://localhost:3000` | машина разработчика | `npm run dev` |
| **тестовый** | `https://mavita.alexzah.ru` (планируется) | VPS `147.45.72.20` | только после Паузы 1 |
| **production** | `https://<домен МАВИТА>` | тот же VPS или отдельный | только после Паузы 1 |

---

## Тестовый стенд — VPS `147.45.72.20`

**Это общий VPS** — на нём уже работает `invoice-lifecycle` (invoices.ztz.spb.ru / alexzah.ru).
МАВИТА-ШОП будет развёрнут рядом как отдельный systemd-сервис с отдельным nginx vhost.

| Параметр | Значение |
| --- | --- |
| IP | `147.45.72.20` |
| ОС | Ubuntu 24.04 |
| SSH alias | `invoice-vps` (из `~/.ssh/config`) |
| SSH ключ | `~/.ssh/invoice_vps_ed25519` |
| Прямой доступ | `ssh root@147.45.72.20 -i ~/.ssh/invoice_vps_ed25519` |
| Nginx | системный, vhosts в `/etc/nginx/sites-enabled/` |
| Уже работает | `docker compose` в `/opt/invoice-lifecycle/` (порты 3000, 3001) |

### Планируемое размещение МАВИТА-ШОП

```
/var/www/mavita/          — код Next.js
/etc/nginx/sites-enabled/mavita.alexzah.ru   — vhost
PM2                       — process manager (не docker, чтобы не конфликтовать)
PostgreSQL                — отдельная БД mavita на том же postgres-сервере
```

Порт: `3002` (3000 и 3001 заняты invoice-lifecycle).

### nginx vhost (заготовка)

```nginx
server {
    listen 443 ssl;
    server_name mavita.alexzah.ru;

    ssl_certificate     /etc/letsencrypt/live/mavita.alexzah.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mavita.alexzah.ru/privkey.pem;

    location /uploads/ {
        alias /var/www/mavita/public/uploads/;
        expires 30d;
    }

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

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
