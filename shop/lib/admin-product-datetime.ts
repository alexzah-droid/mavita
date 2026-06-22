// Конвертация момента скидки между абсолютным RFC 3339-instant (как хранит БД и
// принимает API) и значением поля <input type="datetime-local"> в ЛОКАЛЬНОЙ зоне
// браузера. Поле работает с точностью до минуты (step="60"), поэтому контракт
// расписания тоже минутный. Функции возвращают discriminated result, а не бросают
// исключение — preview и submit обязаны обработать ошибку, не вызывая toISOString()
// у некорректной даты.

export type DateTimeResult = { ok: true; value: string; warning?: string } | { ok: false; message: string }

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const pad = (value: number, length = 2): string => String(value).padStart(length, '0')
const formatOffset = (minutesEast: number): string => {
  const sign = minutesEast >= 0 ? '+' : '-'; const abs = Math.abs(minutesEast)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/**
 * RFC 3339 instant → строка `YYYY-MM-DDTHH:mm` в локальной зоне браузера через
 * локальные getter-ы `Date`. Невалидный или не-минутный instant отклоняется, а
 * не округляется молча.
 */
export function instantToDateTimeLocal(iso: string): DateTimeResult {
  const date = new Date(iso)
  const time = date.getTime()
  if (Number.isNaN(time)) return { ok: false, message: 'Некорректная дата скидки' }
  if (time % MINUTE_MS !== 0) return { ok: false, message: 'Время скидки должно быть с точностью до минуты' }
  const value = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  return { ok: true, value }
}

/**
 * Значение `datetime-local` интерпретируется как локальное время браузера и
 * переводится в ISO-момент через `new Date(year, month - 1, day, hour, minute)`.
 * Если получившиеся локальные компоненты не совпадают с введёнными
 * (несуществующее время DST-gap), возвращается ошибка. Для DST-overlap
 * сохраняется браузерный вариант конструктора (обычно более ранний offset).
 */
export function dateTimeLocalToInstant(value: string): DateTimeResult {
  const match = LOCAL_RE.exec(value)
  if (!match) return { ok: false, message: 'Время скидки должно быть с точностью до минуты' }
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  if (Number.isNaN(date.getTime())) return { ok: false, message: 'Некорректное время скидки' }
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute)
    return { ok: false, message: 'Такого времени не существует в этот день (переход на летнее время)' }
  // DST-overlap: то же локальное время встречается дважды (откат на зимнее время).
  // Откат бывает не только часовым (напр. Australia/Lord_Howe — 30 мин), поэтому
  // ищем альтернативный instant по ФАКТИЧЕСКИМ offset до и после перехода в этот
  // день, а не по фиксированному часу. Время неоднозначно, если оба кандидата
  // (wall − offsetBefore и wall − offsetAfter) различны и оба дают введённые
  // настенные компоненты. Конструктор возвращает более раннее вхождение.
  const wallUTC = Date.UTC(year, month - 1, day, hour, minute)
  const offsetBefore = -new Date(wallUTC - DAY_MS).getTimezoneOffset()
  const offsetAfter = -new Date(wallUTC + DAY_MS).getTimezoneOffset()
  const rendersToWall = (ms: number) => {
    const probe = new Date(ms)
    return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day && probe.getHours() === hour && probe.getMinutes() === minute
  }
  const candidates = [wallUTC - offsetBefore * MINUTE_MS, wallUTC - offsetAfter * MINUTE_MS].filter(rendersToWall)
  if (new Set(candidates).size > 1) return { ok: true, value: date.toISOString(), warning: `Это время повторяется при переходе на зимнее время; выбран более ранний момент (offset ${formatOffset(-date.getTimezoneOffset())})` }
  return { ok: true, value: date.toISOString() }
}
