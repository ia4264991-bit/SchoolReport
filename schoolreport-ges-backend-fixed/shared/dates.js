/**
 * Dates as 'YYYY-MM-DD' strings. Ghana keeps GMT all year (no daylight saving), so the
 * school day is the UTC day.
 */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function addMonths(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  const wantDay = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  // 31 Jan + 1 month → 28/29 Feb, not 3 Mar.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(wantDay, last))
  return d.toISOString().slice(0, 10)
}

export function isDay(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
    && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
}

/** "Tue 19 Nov" — short and SMS-friendly. */
export function shortDay(day) {
  const d = new Date(`${day}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}
