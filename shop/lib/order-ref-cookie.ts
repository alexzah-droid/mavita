// Cookie-привязка «этот браузер оформил заказ N» для возвратов с Робокассы.
// Ставится при создании заказа (/api/robokassa/init) и при повторной оплате
// (/api/robokassa/pay), читается в success/fail.
//
// Зачем: token — единственная защита /order/<token> (там email, состав, адрес ПВЗ),
// а success/fail получают от Робокассы лишь перебираемый InvId. Робокасса подписывает
// только SuccessURL (Пароль#1), FailURL приходит без подписи — cookie единственный
// способ отличить настоящего покупателя от перебора InvId=1..N.
// SameSite=Lax отдаёт cookie на top-level GET-редиректе с auth.robokassa.ru.
import 'server-only'

export const ORDER_REF_COOKIE = 'mavita_order_ref'
// 6 часов: хватает на «отложил оплату и вернулся» в той же сессии; протухшая cookie
// не ломает ничего — покупатель просто откроет заказ по своей ссылке /order/<token>.
export const ORDER_REF_TTL_S = 6 * 60 * 60

export function orderRefValue(invId: number, token: string): string {
  return `${invId}:${token}`
}

export function orderRefCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/robokassa',
    maxAge: ORDER_REF_TTL_S,
  }
}

/** Разобрать значение cookie. null при отсутствии или мусоре. */
export function parseOrderRef(raw: string | undefined): { invId: number; token: string } | null {
  if (!raw) return null
  const idx = raw.indexOf(':')
  if (idx <= 0) return null
  const invId = Number(raw.slice(0, idx))
  const token = raw.slice(idx + 1)
  if (!Number.isInteger(invId) || invId <= 0 || !token) return null
  return { invId, token }
}
