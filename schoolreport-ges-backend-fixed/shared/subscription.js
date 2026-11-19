/**
 * Where a school stands with its subscription.
 *   active  — trial or paid period running (or a complimentary school)
 *   grace   — period ended less than GRACE_DAYS ago: everything still works, with a warning
 *   locked  — read-only: the school can view and print, but not change anything
 */
export const graceDays = () => parseInt(process.env.SUBSCRIPTION_GRACE_DAYS || '14', 10)

const DAY_MS = 24 * 60 * 60 * 1000

export function subscriptionState(school, now = new Date()) {
  if (!school || school.plan === 'complimentary') return { status: 'active', endsAt: null, daysLeft: null }
  let end = null
  if (school.plan === 'trial' && school.trial_ends_at) end = new Date(school.trial_ends_at)
  if (school.plan === 'paid' && school.paid_until) end = new Date(`${school.paid_until}T23:59:59.999Z`)
  if (!end) return { status: 'locked', endsAt: null, daysLeft: 0 }
  const daysLeft = Math.ceil((end - now) / DAY_MS)
  if (now <= end) return { status: 'active', endsAt: end.toISOString(), daysLeft }
  const graceEndsAt = new Date(end.getTime() + graceDays() * DAY_MS)
  if (now <= graceEndsAt) return { status: 'grace', endsAt: end.toISOString(), graceEndsAt: graceEndsAt.toISOString(), daysLeft }
  return { status: 'locked', endsAt: end.toISOString(), daysLeft }
}

// While locked, these still accept changes: paying, and the signed-in user's own password.
const LOCKED_ALLOWED = [/^\/api\/billing(\/|$)/, /^\/api\/auth\/change-password$/]

export function lockedWriteBlocked(req, state) {
  if (state.status !== 'locked') return false
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false
  const path = req.originalUrl.split('?')[0]
  return !LOCKED_ALLOWED.some((re) => re.test(path))
}
