import { query } from '../../shared/db.js'
import { hashPassword } from '../../services/auth/src/models/User.js'

const DEV_DEFAULT_PASSWORD = 'SuperAdmin@2024!'

/**
 * Creates the platform superadmin on first boot.
 * Production: SUPERADMIN_PASSWORD must be set, because the development default is
 * public in this repository and would let anyone log in.
 * Development: falls back to the default and forces a password change on first login.
 */
export async function seedSuperadmin({ log = console.log } = {}) {
  const { rowCount } = await query("SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1")
  if (rowCount) return

  const email = (process.env.SUPERADMIN_EMAIL || 'superadmin@schoolreport.ges').trim().toLowerCase()
  let password = process.env.SUPERADMIN_PASSWORD
  let mustChange = false
  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Server] ⚠ No superadmin exists and SUPERADMIN_PASSWORD is not set — none was created. ' +
        'Set SUPERADMIN_PASSWORD (and SUPERADMIN_EMAIL) and restart.')
      return
    }
    password = DEV_DEFAULT_PASSWORD
    mustChange = true
    console.warn(`[Server] SUPERADMIN_PASSWORD not set — using the development default for ${email}.`)
  }

  await query(
    `INSERT INTO users (full_name, email, username, password_hash, role, school_id, must_change_password)
     VALUES ($1, $2, 'superadmin', $3, 'superadmin', NULL, $4)
     ON CONFLICT DO NOTHING`,
    [process.env.SUPERADMIN_NAME || 'Super Admin', email, await hashPassword(password), mustChange]
  )
  log(`[Server] ✅ Superadmin created → ${email}`)
}
