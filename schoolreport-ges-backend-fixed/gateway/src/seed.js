import { query } from '../../shared/db.js'
import { log as logger } from '../../shared/log.js'
import { hashPassword } from '../../services/auth/src/models/User.js'

const DEV_DEFAULT_PASSWORD = 'SuperAdmin@2024!'

/**
 * Creates the platform superadmin on first boot, with a password that must be changed
 * at first login (it is a bootstrap credential: it sits in config or a secret store).
 * Production: SUPERADMIN_PASSWORD must be set, because the development default is
 * public in this repository and would let anyone log in.
 */
export async function seedSuperadmin({ log = (m) => logger.info(m) } = {}) {
  const { rowCount } = await query("SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1")
  if (rowCount) return

  const email = (process.env.SUPERADMIN_EMAIL || 'superadmin@schoolreport.ges').trim().toLowerCase()
  let password = process.env.SUPERADMIN_PASSWORD
  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('no superadmin exists and SUPERADMIN_PASSWORD is not set — none was created')
      return
    }
    password = DEV_DEFAULT_PASSWORD
    logger.warn('SUPERADMIN_PASSWORD not set — using the development default', { email })
  }

  await query(
    `INSERT INTO users (full_name, email, username, password_hash, role, school_id, must_change_password)
     VALUES ($1, $2, 'superadmin', $3, 'superadmin', NULL, true)
     ON CONFLICT DO NOTHING`,
    [process.env.SUPERADMIN_NAME || 'Super Admin', email, await hashPassword(password)]
  )
  log(`superadmin created: ${email} (must change password at first login)`)
}
