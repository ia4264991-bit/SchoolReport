import nodemailer from 'nodemailer'

// Build transporter fresh every call — env vars are read AFTER dotenv loads
function makeTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     15000,
  })
}

// Core send — THROWS on failure so callers know exactly what went wrong
async function _send({ to, subject, html }) {
  const from = process.env.EMAIL_FROM || '"SchoolReport GES" <noviqsystem486@gmail.com>'

  console.log(`[Mailer] Sending "${subject}" → ${to}`)
  console.log(`[Mailer] SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} user=${process.env.SMTP_USER}`)

  const transporter = makeTransporter()

  await transporter.verify()
  console.log('[Mailer] ✅ SMTP connection verified')

  const info = await transporter.sendMail({ from, to, subject, html })
  console.log(`[Mailer] ✉  Delivered! id=${info.messageId}`)
  return info
}

// Safe wrapper — logs error, returns null instead of throwing
async function _sendSafe(args) {
  try {
    return await _send(args)
  } catch (err) {
    console.error(`[Mailer] ✗ FAILED "${args.subject}" → ${args.to} :`, err.message)
    return null
  }
}

/* ── TEST ─────────────────────────────────────────────────────── */
export async function sendTestEmail(to) {
  return _send({
    to,
    subject: '✅ SchoolReport GES — SMTP Test',
    html: `
    <div style="font-family:Arial,sans-serif;padding:24px;border:1px solid #e0e0e0;border-radius:10px;max-width:480px;margin:0 auto;">
      <h2 style="color:#185FA5;">SMTP is working!</h2>
      <p>Your SchoolReport GES backend can send emails.</p>
      <table style="font-size:12px;color:#888;border-collapse:collapse;margin-top:12px;">
        <tr><td style="padding:3px 8px;">Sent at</td><td>${new Date().toISOString()}</td></tr>
        <tr><td style="padding:3px 8px;">FROM</td><td>${process.env.EMAIL_FROM}</td></tr>
        <tr><td style="padding:3px 8px;">SMTP</td><td>${process.env.SMTP_HOST}:${process.env.SMTP_PORT}</td></tr>
        <tr><td style="padding:3px 8px;">User</td><td>${process.env.SMTP_USER}</td></tr>
      </table>
    </div>`,
  })
}

/* ── WELCOME (new user credentials) ──────────────────────────── */
export async function sendWelcomeEmail({ to, fullName, email, tempPassword, role, schoolName }) {
  const BASE = process.env.FRONTEND_URL || 'http://localhost:5173'
  const result = await _sendSafe({
    to,
    subject: `Your ${schoolName} Account — Login Credentials`,
    html: `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e3e8f0;border-radius:14px;overflow:hidden;">
      <div style="background:#185FA5;padding:24px 28px;text-align:center;">
        <span style="color:#fff;font-size:20px;font-weight:700;">SchoolReport GES</span>
        <p style="color:#b3d4f5;margin:6px 0 0;font-size:13px;">Ghana Education Service</p>
      </div>
      <div style="padding:28px;">
        <h2 style="color:#185FA5;margin:0 0 8px;">Welcome, ${fullName}!</h2>
        <p style="color:#555;margin:0 0 20px;">Your account has been created at <strong>${schoolName}</strong>. Use the details below to log in.</p>
        <div style="background:#f4f6fb;border-radius:10px;padding:20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#888;font-size:13px;padding:6px 10px;width:40%;">Login URL</td>
                <td style="font-weight:600;padding:6px 10px;"><a href="${BASE}/login" style="color:#185FA5;">${BASE}/login</a></td></tr>
            <tr style="background:#eef2f9;">
                <td style="color:#888;font-size:13px;padding:6px 10px;">Email</td>
                <td style="font-weight:600;padding:6px 10px;">${email}</td></tr>
            <tr><td style="color:#888;font-size:13px;padding:6px 10px;">Password</td>
                <td style="padding:6px 10px;"><span style="font-size:20px;font-weight:700;color:#c0392b;letter-spacing:2px;">${tempPassword}</span></td></tr>
            <tr style="background:#eef2f9;">
                <td style="color:#888;font-size:13px;padding:6px 10px;">Role</td>
                <td style="font-weight:600;padding:6px 10px;text-transform:capitalize;">${role}</td></tr>
          </table>
        </div>
        <div style="background:#fff8e8;border:1px solid #fac775;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
          <p style="margin:0;font-size:13px;color:#854f0b;">⚠️ <strong>Important:</strong> You must change your password immediately after first login.</p>
        </div>
        <a href="${BASE}/login" style="display:inline-block;padding:13px 32px;background:#185FA5;color:#fff;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px;">Login Now →</a>
      </div>
      <div style="background:#f8f9fc;padding:14px 28px;border-top:1px solid #e8ecf3;">
        <p style="margin:0;font-size:11px;color:#aaa;">Automated message from SchoolReport GES. Do not reply.</p>
      </div>
    </div>`,
  })
  return result !== null
}

/* ── OTP (password reset code) ───────────────────────────────── */
export async function sendOTPEmail({ to, fullName, otp }) {
  const result = await _sendSafe({
    to,
    subject: `${otp} — Your SchoolReport GES Reset Code`,
    html: `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e3e8f0;border-radius:14px;overflow:hidden;">
      <div style="background:#185FA5;padding:20px 28px;text-align:center;">
        <span style="color:#fff;font-size:18px;font-weight:700;">SchoolReport GES</span>
      </div>
      <div style="padding:28px;">
        <h2 style="color:#185FA5;margin:0 0 8px;">Password Reset Code</h2>
        <p style="color:#555;margin:0 0 24px;">Hello <strong>${fullName}</strong>, use the code below to reset your password.</p>
        <div style="text-align:center;background:#f4f6fb;border-radius:12px;padding:28px;margin-bottom:20px;">
          <div style="font-size:42px;font-weight:900;letter-spacing:10px;color:#185FA5;">${otp}</div>
          <p style="margin:12px 0 0;font-size:13px;color:#888;">Expires in <strong>10 minutes</strong></p>
        </div>
        <div style="background:#fff8e8;border:1px solid #fac775;border-radius:8px;padding:12px 16px;">
          <p style="margin:0;font-size:13px;color:#854f0b;">⚠️ If you did not request this, ignore this email.</p>
        </div>
      </div>
      <div style="background:#f8f9fc;padding:12px 28px;border-top:1px solid #e8ecf3;">
        <p style="margin:0;font-size:11px;color:#aaa;">Automated message from SchoolReport GES. Do not reply.</p>
      </div>
    </div>`,
  })
  return result !== null
}

/* ── ADMIN RESET ─────────────────────────────────────────────── */
export async function sendAdminResetEmail({ to, fullName, newPassword, schoolName }) {
  const BASE = process.env.FRONTEND_URL || 'http://localhost:5173'
  const result = await _sendSafe({
    to,
    subject: `Password Reset — ${schoolName}`,
    html: `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e3e8f0;border-radius:14px;overflow:hidden;">
      <div style="background:#185FA5;padding:20px 28px;text-align:center;">
        <span style="color:#fff;font-size:18px;font-weight:700;">SchoolReport GES</span>
      </div>
      <div style="padding:28px;">
        <h2 style="color:#185FA5;margin:0 0 8px;">Your Password Was Reset</h2>
        <p style="color:#555;margin:0 0 20px;">Hello <strong>${fullName}</strong>, an administrator at <strong>${schoolName}</strong> has reset your password.</p>
        <div style="background:#f4f6fb;border-radius:10px;padding:20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#888;font-size:13px;padding:5px 10px;">New Password</td>
                <td style="font-size:20px;font-weight:700;color:#c0392b;letter-spacing:2px;padding:5px 10px;">${newPassword}</td></tr>
          </table>
        </div>
        <div style="background:#fcebeb;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
          <p style="margin:0;font-size:13px;color:#c0392b;">⚠️ You must change your password immediately after logging in.</p>
        </div>
        <a href="${BASE}/login" style="display:inline-block;padding:12px 28px;background:#185FA5;color:#fff;border-radius:9px;text-decoration:none;font-weight:700;">Login Now →</a>
      </div>
      <div style="background:#f8f9fc;padding:12px 28px;border-top:1px solid #e8ecf3;">
        <p style="margin:0;font-size:11px;color:#aaa;">Automated message from SchoolReport GES. Do not reply.</p>
      </div>
    </div>`,
  })
  return result !== null
}
