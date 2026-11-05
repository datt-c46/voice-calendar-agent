function validTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined
  try {
    new Intl.DateTimeFormat('vi-VN', { timeZone })
    return timeZone
  } catch {
    return undefined
  }
}

/** `15:00 • 06/11/2026`, in the event's time zone (the server expresses times in the user's zone). */
export function formatEventTime(isoString: string | undefined, timeZone?: string): string {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return isoString
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: validTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: false
  }).formatToParts(d)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value || '00'
  return `${get('hour')}:${get('minute')} • ${get('day')}/${get('month')}/${get('year')}`
}

/** All-day `YYYY-MM-DD` → `06/11/2026`. */
export function formatEventDate(date: string): string {
  const [y, m, d] = date.split('-')
  return y && m && d ? `${d}/${m}/${y}` : date
}

/** The all-day end date is exclusive: a one-day event on 06/11 ends on 07/11. */
export function lastAllDayDate(start: string, endExclusive: string | undefined): string | null {
  if (!endExclusive) return null
  const end = new Date(`${endExclusive}T00:00:00Z`)
  if (isNaN(end.getTime())) return null
  end.setUTCDate(end.getUTCDate() - 1)
  const last = end.toISOString().slice(0, 10)
  return last > start ? last : null
}
