// Уборка in-memory TTL-кэшей (Map со значениями { expiresAt }). Без неё Map растёт
// бесконечно: TTL проверяется только при чтении того же ключа, а уникальные ключи
// (перебор city_code, подсказок города) добавляют записи навсегда — до OOM процесса.
// Вызывать ПЕРЕД записью: выметает протухшее; если всё ещё тесно — удаляет старейшие
// записи (порядок итерации Map = порядок вставки).
export function pruneTtlMap<V extends { expiresAt: number }>(
  map: Map<string, V>,
  maxEntries: number,
): void {
  const now = Date.now()
  for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key)
  while (map.size >= maxEntries) map.delete(map.keys().next().value!)
}
