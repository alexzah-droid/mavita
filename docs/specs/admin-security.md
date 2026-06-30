# Безопасность админки МАВИТА

**Статус:** основа планирования roadmap, не реализационная спека одной задачи.  
**Актуализировано:** 2026-06-30.  
**Источник статуса:** код + `ROADMAP.md`; этот файл фиксирует backlog и
требования к следующим security-задачам.

---

## Текущее состояние

- **Сессии:** `iron-session`, cookie `HttpOnly`, `Secure` в production,
  `SameSite=lax`.
- **Session TTL:** 8 часов в `shop/lib/auth.ts`.
- **Вход:** один пароль из `ADMIN_PASSWORD`, сравнение через SHA-256 +
  `timingSafeEqual`.
- **CSRF для мутаций:** same-origin check по `Origin` и `Host`.
- **Rate limit:** уже есть в `app/api/auth/login/route.ts`, но только
  process-local `Map`: 5 ошибок за 60 секунд на IP.
- **Нет пока:** общего PG-backed login limiter, аудита входов, MFA, просмотра
  попыток входа, trusted-device/trusted-IP логики.

### Что уже неактуально

Старое утверждение «нет rate limiting» неверно. Правильная формулировка:
rate limit есть, но он не production-grade для нескольких PM2/Node-процессов и
прокси. Следующий шаг — усилить существующую реализацию, а не добавлять
`express-rate-limit`.

---

## Roadmap-решение

### P1. Усилить существующий вход

1. **PG-backed login rate limit**
   - Таблица `admin_login_attempts` или переиспользуемый server-side limiter по
     паттерну `delivery_test_attempts`, но без `actor_login_at`.
   - Ключ: нормализованный trusted IP + optional session/browser key.
   - Лимит: 5 ошибок / 15 минут, `Retry-After`, общий для всех процессов.
   - IP брать только из доверенного proxy-контракта Nginx (`X-Real-IP` /
     первый `X-Forwarded-For` после настройки прокси), не из произвольной цепочки.

2. **Сократить риск украденной cookie**
   - Уменьшить TTL/idle timeout с 8 часов до 30-60 минут.
   - При активной работе с админкой продлевать сессию штатным механизмом
     `iron-session`; при бездействии требовать новый вход.

3. **Аудит входов**
   - Таблица `admin_login_log`:
     ```sql
     id BIGSERIAL PRIMARY KEY,
     ip TEXT NOT NULL,
     user_agent TEXT,
     status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'rate_limited')),
     error_reason TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
     ```
   - Логировать успешные входы, неверный пароль, rate-limit, ошибку конфигурации.
   - Добавить минимальную страницу/блок в админке: последние 50 попыток.

### P2. MFA владельца

Основной вариант — TOTP.

- Секрет TOTP хранить зашифрованным через существующий механизм
  `SETTINGS_ENC_KEY` / `secret-box`, а не открытым текстом.
- Backup codes хранить только хешами; одноразовое использование.
- Вход: пароль → при включённом MFA проверка TOTP/backup code → создание сессии.
- Отключение/перегенерация backup codes требует актуального пароля и TOTP.

Минимальная схема:

```sql
CREATE TABLE admin_mfa (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  secret_enc BYTEA,
  enabled BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_mfa_backup_codes (
  id BIGSERIAL PRIMARY KEY,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### P3. Уведомления и trusted IP

Email-OTP не берём как основной MFA: он слабее TOTP и зависит от почты. Email
или Telegram-уведомление о новом IP полезно после появления аудита входов.

Возможная схема:

```sql
CREATE TABLE admin_trusted_ips (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT UNIQUE NOT NULL,
  first_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Уведомление отправлять только после успешного входа с нового IP. Не блокировать
вход только из-за недоставленного уведомления.

---

## Не брать в ближайший цикл

- **WebAuthn/FIDO2**: хороший future option, но избыточен до появления аудита,
  общего rate limit и TOTP.
- **Email OTP как основной MFA**: повышает трение и зависит от компрометации
  почтового ящика.
- **Общие чеклисты CSP/HSTS/CORS вместо конкретных задач**: делать отдельным
  hardening-заходом после P1/P2.

---

## Критерии готовности ближайшей задачи

- [ ] Login limiter хранит попытки в БД и работает одинаково при нескольких
      Node/PM2-процессах.
- [ ] Rate-limit ответ содержит `429` и корректный `Retry-After`.
- [ ] Успешный вход сбрасывает счётчик ошибок для ключа.
- [ ] Входы и ошибки пишутся в `admin_login_log`.
- [ ] В админке видна история входов без раскрытия лишних персональных данных.
- [ ] TTL админ-сессии сокращён и покрыт тестом.
