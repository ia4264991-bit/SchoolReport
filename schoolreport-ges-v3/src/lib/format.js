/**
 * 'YYYY-MM-DD' → "12 January 2027". Spelled-out months avoid the 1/12 vs 12/1 confusion
 * between US-set computers and Ghanaian readers, and it is read as a local date so the
 * day never shifts with the time zone.
 */
export function formatDate(isoDate) {
  if (!isoDate) return ''
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** 'YYYY-MM-DD' → "Thu 19 Nov" */
export function shortDate(isoDate) {
  if (!isoDate) return ''
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Today as 'YYYY-MM-DD' (Ghana is on GMT all year). */
export const todayIso = () => new Date().toISOString().slice(0, 10)

/** 1234.5 → "GHS 1,234.50" */
export function cedis(n) {
  const v = Number(n || 0)
  return `GHS ${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "+233244123456" → "024 412 3456" */
export function localPhone(p) {
  if (!p || !String(p).startsWith('+233')) return p || ''
  const n = `0${String(p).slice(4)}`
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd" */
export function ordinal(n) {
  if (!Number.isFinite(Number(n))) return '—'
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}
