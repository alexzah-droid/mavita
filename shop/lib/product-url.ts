import type { Visibility } from '@/lib/products'

/** Путь карточки товара на витрине. Единственный источник формы URL. */
export const productPath = (slug: string): string => `/product/${slug}`

/** Абсолютная ссылка для копирования (origin без завершающего слэша + путь). */
export const productUrl = (slug: string, origin: string): string =>
  `${origin.replace(/\/+$/, '')}${productPath(slug)}`

/** Товар открывается по прямой ссылке ⇔ он не скрыт (§3.1: public/unlisted). */
export const isAccessibleByLink = (visibility: Visibility): boolean => visibility !== 'hidden'

/** Чистая перестановка: переносит элемент с позиции from на позицию to. */
export function moveInOrder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
