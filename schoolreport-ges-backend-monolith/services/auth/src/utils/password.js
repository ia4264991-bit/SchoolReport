import crypto from 'crypto'

/**
 * Generates a secure, readable temporary password
 * Always includes uppercase, lowercase, digit, and special char
 */
export function generateTempPassword(length = 10) {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower   = 'abcdefghjkmnpqrstuvwxyz'
  const digits  = '23456789'
  const special = '@#$!'
  const all     = upper + lower + digits + special

  let pw = ''
  pw += upper[crypto.randomInt(upper.length)]
  pw += lower[crypto.randomInt(lower.length)]
  pw += digits[crypto.randomInt(digits.length)]
  pw += special[crypto.randomInt(special.length)]
  for (let i = 4; i < length; i++) pw += all[crypto.randomInt(all.length)]

  // Shuffle
  return pw.split('').sort(() => crypto.randomInt(3) - 1).join('')
}

/**
 * Generates a cryptographically secure reset token (hex string)
 */
export function generateResetToken() {
  return crypto.randomBytes(32).toString('hex')
}
