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
