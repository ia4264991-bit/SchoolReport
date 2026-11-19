/**
 * Ghana phone numbers. Stored as E.164 (+233 and 9 digits). People type them many ways:
 * "024 412 3456", "0244123456", "+233 24 412 3456", "233244123456", "244123456".
 * Returns null when the input is not a Ghana number.
 */
export function normalizeGhanaPhone(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  let s = String(raw).trim().replace(/[\s\-().]/g, '')
  if (!s) return null
  if (s.startsWith('+233')) s = s.slice(4)
  else if (s.startsWith('00233')) s = s.slice(5)
  else if (s.startsWith('233') && s.length === 12) s = s.slice(3)
  else if (s.startsWith('0') && s.length === 10) s = s.slice(1)
  // National number: 9 digits. Mobile and fixed lines start with 2, 3 or 5.
  if (!/^[235]\d{8}$/.test(s)) return null
  return `+233${s}`
}

/** "+233 24 *** 3456" — for logs and for "we sent a code to …" messages. */
export function maskPhone(p) {
  if (typeof p !== 'string' || p.length < 8) return '***'
  return `${p.slice(0, 4)} ${p.slice(4, 6)} *** ${p.slice(-4)}`
}

/** "024 412 3456" — how Ghanaians write a number. */
export function localPhone(p) {
  if (typeof p !== 'string' || !p.startsWith('+233')) return p || ''
  const n = `0${p.slice(4)}`
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
}
