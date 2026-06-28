# Безопасность админки МАВИТА

**Статус:** Предложение вариантов (решение позже)  
**Дата:** 2026-06-27  
**Автор:** Claude Code

---

## Текущее состояние

- **Система:** `iron-session` + SHA256 хеширование пароля
- **Session TTL:** 8 часов
- **Защита:** Secure cookie (HTTPS), HttpOnly, SameSite=lax, Same-Origin check
- **Уязвимости:** 
  - Нет rate limiting → brute-force возможен
  - Нет 2FA → украденный пароль = доступ в админку
  - Нет логирования входов → не видно неудачные попытки
  - Длинная сессия (8 часов) → риск при краже cookie

---

## ВАРИАНТ 1: Минимальные улучшения (быстро, низкий риск)

**Трудоёмкость:** 2-3 часа  
**Безопасность:** 6/10  
**Рекомендуется для:** Текущего уровня продаж

### Что добавить:

1. **Rate limiting на POST /admin/login**
   - Макс 5 попыток в 15 минут (на IP)
   - Задержка 1 сек после ошибки
   - Блокировка IP на 1 час после 5 ошибок
   - **Библиотека:** `express-rate-limit`

2. **Сокращение session TTL**
   - С 8 часов → 30 минут неактивности
   - При неактивности 30 мин → автоматический выход
   - **Файл для правки:** `lib/auth.ts` (строка 10)

3. **Логирование входов в БД**
   - Таблица `admin_login_log`:
     ```sql
     id, ip, user_agent, status (success|failed), error_reason, created_at
     ```
   - Логировать каждую попытку (успешную и неудачную)
   - Просмотр в админке (для Виктории)

4. **Email-уведомление при входе**
   - Только для **новых IP** (требует IP-отслеживания)
   - Таблица `admin_trusted_ips`: (ip, last_login_at, trusted_at)
   - При входе с нового IP: письмо на `mavitasvechi@mail.ru`
   - **Библиотека:** `nodemailer` (уже используется?)

### Примерный SQL:

```sql
CREATE TABLE admin_login_log (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  user_agent TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_login_log_ip_created ON admin_login_log (ip, created_at DESC);

CREATE TABLE admin_trusted_ips (
  id SERIAL PRIMARY KEY,
  ip TEXT UNIQUE NOT NULL,
  last_login_at TIMESTAMPTZ,
  trusted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Плюсы:
- ✅ Быстро реализуется
- ✅ Защита от brute-force
- ✅ Видна история входов
- ✅ Email-алерт при подозрительной активности

### Минусы:
- ❌ Нет 2FA → пароль остаётся единственной защитой
- ❌ Нет аппаратной защиты (WebAuthn)
- ❌ Если пароль украден, доступ открыт

---

## ВАРИАНТ 2: TOTP (Google Authenticator) — Средний уровень

**Трудоёмкость:** 6-8 часов  
**Безопасность:** 8/10  
**Рекомендуется для:** Когда начнутся регулярные продажи

### Что добавить:

1. **TOTP (Time-based One-Time Password)**
   - Пользователь генерирует 6-значный код в Google Authenticator / Authy
   - Код действует 30 секунд
   - Требуется при каждом входе

2. **Таблица для TOTP**
   ```sql
   CREATE TABLE admin_mfa (
     id SERIAL PRIMARY KEY,
     secret_enc BYTEA NOT NULL,  -- зашифрованный secret (AES-256-GCM)
     backup_codes TEXT[] NOT NULL, -- 10 одноразовых кодов на случай потери телефона
     enabled BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     activated_at TIMESTAMPTZ
   );
   ```

3. **API endpoints**
   - `POST /api/admin/mfa/setup` — генерирует QR-код, возвращает secret
   - `POST /api/admin/mfa/confirm` — верификация кода TOTP для активации
   - `POST /api/admin/mfa/disable` — отключение (требует пароля)
   - `POST /api/admin/mfa/backup-codes` — генерирует новые backup codes

4. **Поток входа**
   - Шаг 1: Пользователь вводит пароль
   - Шаг 2: Если TOTP активна → требуется 6-значный код
   - Шаг 3: Сессия создаётся только после обоих

5. **Backup codes**
   - 10 кодов выдаются при первой настройке TOTP
   - Каждый код одноразовый
   - Хранятся в БД в хешированном виде
   - Для случая если потеря/кража телефона

### Библиотеки:
- `speakeasy` — генерация TOTP secret и верификация кодов
- `qrcode` — генерация QR-кода для Google Authenticator

### Плюсы:
- ✅ Максимальная безопасность для пароля
- ✅ Не требует интернета на телефоне (TOTP работает offline)
- ✅ Google Authenticator / Authy — уже установлены у людей
- ✅ Не зависит от SMS/Email доступности
- ✅ Backup codes для восстановления

### Минусы:
- ❌ Требует установки приложения
- ❌ Если потеря телефона + потеря backup codes → нужна помощь
- ❌ Может быть неудобно (требует доступ к телефону каждый раз)
- ❌ Долгая реализация (6-8 часов)

---

## ВАРИАНТ 3: OTP по Email — Простой вариант

**Трудоёмкость:** 4-5 часов  
**Безопасность:** 7/10  
**Рекомендуется для:** Если Виктория часто теряет телефон

### Что добавить:

1. **OTP по Email**
   - При входе: отправляется 6-значный код на `mavitasvechi@mail.ru`
   - Код действует 10 минут
   - Требуется ввод на странице входа

2. **Таблица для OTP**
   ```sql
   CREATE TABLE admin_otp_tokens (
     id SERIAL PRIMARY KEY,
     token_hash TEXT UNIQUE NOT NULL,  -- хеш кода
     attempts_left INTEGER NOT NULL DEFAULT 3,
     expires_at TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```

3. **API endpoints**
   - `POST /api/admin/otp/send` — генерирует и отправляет код по email
   - `POST /api/admin/otp/verify` — проверяет код, создаёт сессию

### Плюсы:
- ✅ Простая реализация
- ✅ Не требует установки приложения
- ✅ Хороша для забывчивых
- ✅ Быстро кодировать

### Минусы:
- ❌ Зависит от доступности email
- ❌ Медленнее (нужно ждать письма)
- ❌ Может попасть в spam
- ❌ Меньше безопасность (email может быть скомпрометирован)

---

## ВАРИАНТ 4: Комбинированный подход (максимум)

**Трудоёмкость:** 10-12 часов  
**Безопасность:** 9/10  
**Рекомендуется для:** Когда бизнес растёт и хочется максимум защиты

### Что добавить:

- **Rate limiting + session timeout** (из варианта 1)
- **TOTP** (из варианта 2) — основной способ
- **Email OTP** (из варианта 3) — backup если потеря телефона
- **WebAuthn / FIDO2** (опционально) — для максимума: YubiKey, Windows Hello
- **IP-check** — алерт при смене IP
- **Device fingerprint** — отслеживание устройств

---

## 📋 Рекомендация

### **На сейчас (ВАРИАНТ 1): Минимум за 2-3 часа**

```
[ ] Rate limiting на /admin/login
[ ] Session timeout → 30 минут
[ ] Логирование входов в БД
[ ] Email-уведомление при новом IP
[ ] Просмотр истории входов в админке
```

**Аргумент:** Защита от brute-force + видимость попыток взлома. Быстро, даёт результат.

---

### **На Q3 2026 (ВАРИАНТ 2): TOTP**

```
[ ] TOTP (Google Authenticator)
[ ] Backup codes
[ ] Настройка в админке
[ ] QR-код при первой настройке
```

**Аргумент:** Когда начнутся регулярные заказы, нужна серьёзная защита. TOTP — стандарт для критичных систем.

---

### **Не делать (пока)**

- ❌ WebAuthn (слишком сложно, нишевое)
- ❌ SMS OTP (ненадёжно в России, дорого)
- ❌ Биометрия (не нужна для единственного админа)

---

## Текущие параметры в коде

**Файл:** `shop/lib/auth.ts`

```typescript
// Текущие настройки:
ttl: 60 * 60 * 8,  // 8 часов — СЛИШКОМ ДОЛГО
cookieOptions: { 
  httpOnly: true,      // ✅ хорошо
  secure: true,        // ✅ хорошо (HTTPS)
  sameSite: 'lax',     // ✅ хорошо
  maxAge: 60 * 60 * 8 - 60  // ✅ синхро с ttl
}
```

**Рекомендация:** При любом варианте сначала изменить `ttl` на 30 минут:

```typescript
ttl: 30 * 60,  // 30 минут неактивности
```

---

## Решение принимаешь ты

**Напиши:**
- Вариант 1, 2, 3 или 4?
- Когда реализовать?
- Виктория согласна с TOTP (скачивать Google Authenticator)?

**По умолчанию рекомендую:** Вариант 1 (быстро) + Вариант 2 (в Q3).
