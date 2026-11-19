import api from '@/lib/api'

/*
 * Registers taken without network. A teacher marks the class in the classroom, where data
 * is often weak: if saving fails because the phone is offline, the register is kept on the
 * phone and sent automatically when the connection comes back (or when the app opens).
 * The class list is cached too, so the register can be taken offline after one online visit.
 */

const QUEUE_KEY = 'sr_attendance_queue'
const ROSTER_KEY = (classId) => `sr_roster_${classId}`

const read = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback }
}
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage full or blocked */ }
}

export const pendingRegisters = () => read(QUEUE_KEY, [])

/** Keeps one pending register per class and day (the newest wins). */
export function queueRegister({ classId, className, day, marks }) {
  const q = pendingRegisters().filter((r) => !(r.classId === classId && r.day === day))
  q.push({ classId, className, day, marks, savedAt: new Date().toISOString() })
  write(QUEUE_KEY, q)
  window.dispatchEvent(new Event('sr-queue-changed'))
}

/** True when a request failed because there was no connection (not a server answer). */
export const isOffline = (err) => !err?.response && (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error' || !navigator.onLine)

let syncing = null
/**
 * Sends every pending register. Returns { sent, failed, left }. A register the server
 * refuses (for example: too old for a teacher) is dropped and reported, not retried forever.
 */
export function syncRegisters() {
  if (syncing) return syncing
  syncing = (async () => {
    let sent = 0
    const failed = []
    for (const r of pendingRegisters()) {
      try {
        await api.put(`/attendance/${r.classId}/${r.day}`, { marks: r.marks })
        sent++
        write(QUEUE_KEY, pendingRegisters().filter((x) => !(x.classId === r.classId && x.day === r.day)))
      } catch (err) {
        if (isOffline(err)) break
        failed.push({ ...r, error: err.response?.data?.message || 'Refused by the server.' })
        write(QUEUE_KEY, pendingRegisters().filter((x) => !(x.classId === r.classId && x.day === r.day)))
      }
    }
    window.dispatchEvent(new Event('sr-queue-changed'))
    return { sent, failed, left: pendingRegisters().length }
  })().finally(() => { syncing = null })
  return syncing
}

export const cacheRoster = (classId, data) => write(ROSTER_KEY(classId), { ...data, cachedAt: new Date().toISOString() })
export const cachedRoster = (classId) => read(ROSTER_KEY(classId), null)

/** On sign-out: the next person on this phone must not see the class lists. */
export function clearOfflineData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sr_roster_')) localStorage.removeItem(k)
  } catch { /* ignore */ }
}
