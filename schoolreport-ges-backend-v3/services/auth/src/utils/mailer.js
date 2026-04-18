import nodemailer from 'nodemailer'

let _transporter = null

function getTransporter() {
  if (_transporter) return _transporter
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
  return _transporter
}

const FROM = process.env.EMAIL_FROM || '"SchoolReport GES" <no-reply@schoolreport.ges>'
const BASE = process.env.FRONTEND_URL || 'http://localhost:5173'

/* ─── Credential Welcome Email ─── */
export async function sendWelcomeEmail({ to, fullName, email, tempPassword, role, schoolName }) {
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;padding:28px;border:1px solid #e3e8f0;border-radius:14px;">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="display:inline-block;background:#185FA5;border-radius:10px;padding:10px 20px;">
        <span style="color:#fff;font-weight:700;font-size:17px;">SchoolReport GES</span>
      </div>
    </div>
    <h2 style="color:#185FA5;margin-bottom:4px;">Welcome, ${fullName}!</h2>
    <p style="color:#555;">Your account has been created at <strong>${schoolName}</strong>.</p>
    <table style="width:100%;background:#f4f6fb;border-radius:10px;padding:16px;margin:16px 0;border-collapse:collapse;">
      <tr><td style="color:#888;padding:5px 8px;font-size:13px;">School</td><td style="font-weight:600;padding:5px 8px;">${schoolName}</td></tr>
      <tr><td style="color:#888;padding:5px 8px;font-size:13px;">Role</td><td style="font-weight:600;padding:5px 8px;text-transform:capitalize;">${role}</td></tr>
      <tr><td style="color:#888;padding:5px 8px;font-size:13px;">Email (Login)</td><td style="font-weight:600;padding:5px 8px;">${email}</td></tr>
      <tr><td style="color:#888;padding:5px 8px;font-size:13px;">Temporary Password</td><td style="font-weight:700;color:#c0392b;padding:5px 8px;font-size:15px;">${tempPassword}</td></tr>
    </table>
    <p style="color:#c0392b;font-size:13px;background:#fcebeb;padding:10px 14px;border-radius:8px;">
      ⚠️ You will be required to <strong>change your password</strong> immediately after your first login.
    </p>
    <a href="${BASE}/login" style="display:inline-block;margin-top:16px;padding:11px 28px;background:#185FA5;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">
      Login Now →
    </a>
    <p style="font-size:11px;color:#aaa;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">
      This is an automated message from SchoolReport GES. Do not reply.
    </p>
  </div>`

  await _send({ to, subject: `Your ${schoolName} Account Credentials`, html })
}

/* ─── Password Reset Email ─── */
export async function sendPasswordResetEmail({ to, fullName, resetToken }) {
  const resetUrl = `${BASE}/reset-password?token=${resetToken}`
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;padding:28px;border:1px solid #e3e8f0;border-radius:14px;">
    <h2 style="color:#185FA5;">Password Reset Request</h2>
    <p>Hello <strong>${fullName}</strong>,</p>
    <p>We received a request to reset your password. Click the button below to set a new password.</p>
    <p style="background:#fff8e8;border:1px solid #fac775;padding:10px 14px;border-radius:8px;font-size:13px;color:#854f0b;">
      ⏱ This link expires in <strong>15 minutes</strong>.
    </p>
    <a href="${resetUrl}" style="display:inline-block;margin-top:16px;padding:11px 28px;background:#185FA5;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">
      Reset Password →
    </a>
    <p style="margin-top:16px;font-size:12px;color:#888;">
      If you did not request this, ignore this email. Your password will not change.
    </p>
    <p style="font-size:11px;color:#aaa;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">
      This is an automated message from SchoolReport GES. Do not reply.
    </p>
  </div>`

  await _send({ to, subject: 'Reset Your SchoolReport GES Password', html })
}

/* ─── Admin-triggered password reset email ─── */
export async function sendAdminResetEmail({ to, fullName, newPassword, schoolName }) {
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;padding:28px;border:1px solid #e3e8f0;border-radius:14px;">
    <h2 style="color:#185FA5;">Your Password Has Been Reset</h2>
    <p>Hello <strong>${fullName}</strong>,</p>
    <p>Your password at <strong>${schoolName}</strong> has been reset by an administrator.</p>
    <table style="width:100%;background:#f4f6fb;border-radius:10px;padding:16px;margin:16px 0;border-collapse:collapse;">
      <tr><td style="color:#888;padding:5px 8px;font-size:13px;">New Temporary Password</td>
          <td style="font-weight:700;color:#c0392b;padding:5px 8px;font-size:15px;">${newPassword}</td></tr>
    </table>
    <p style="color:#c0392b;font-size:13px;background:#fcebeb;padding:10px 14px;border-radius:8px;">
      ⚠️ You will be required to <strong>change your password</strong> on next login.
    </p>
    <a href="${BASE}/login" style="display:inline-block;margin-top:16px;padding:11px 28px;background:#185FA5;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">
      Login Now →
    </a>
  </div>`

  await _send({ to, subject: `Password Reset — ${schoolName}`, html })
}

/* ─── Internal send helper ─── */
async function _send({ to, subject, html }) {
  try {
    await getTransporter().sendMail({ from: FROM, to, subject, html })
    console.log(`[Mailer] ✉  Sent "${subject}" → ${to}`)
  } catch (err) {
    // Non-fatal — log but don't crash the request
    console.error(`[Mailer] ✗ Failed to send to ${to}:`, err.message)
  }
}
