import nodemailer from 'nodemailer'

// ─── Create transporter — reads env vars at call time ─────────────
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
    socketTimeout:     15000,
  })
}

// ─── Core send — NO verify() call, just send directly ────────────
async function _send({ to, subject, html }) {
  const from = process.env.EMAIL_FROM
    || '"SchoolReport GES" <noviqsystem486@gmail.com>'

  console.log(`[Mailer] → "${subject}" to ${to}`)

  const transporter = makeTransporter()
  const info = await transporter.sendMail({ from, to, subject, html })

  console.log(`[Mailer] ✅ Sent! id=${info.messageId} accepted=${JSON.stringify(info.accepted)}`)
  return info
}

// ─── Fire and forget — sends in background, never blocks caller ───
// Returns immediately. Logs success/failure to console only.
function _sendBackground(args) {
  _send(args)
    .then(() => console.log(`[Mailer] ✉  Background send OK → ${args.to}`))
    .catch(err => console.error(`[Mailer] ✗ Background send FAILED → ${args.to} :`, err.message))
}

/* ═══════════════════════════════════════════════════════════════
   WELCOME — new user credentials
   Fires in background. Never blocks the HTTP response.
═══════════════════════════════════════════════════════════════ */
export function sendWelcomeEmail({ to, fullName, email, tempPassword, role, schoolName }) {
  const BASE = process.env.FRONTEND_URL || 'http://localhost:5173'

  _sendBackground({
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
        <p style="color:#555;margin:0 0 20px;">
          Your account has been created at <strong>${schoolName}</strong>.
          Use the details below to log in.
        </p>
        <div style="background:#f4f6fb;border-radius:10px;padding:20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="color:#888;font-size:13px;padding:7px 10px;width:38%;">Login URL</td>
              <td style="font-weight:600;padding:7px 10px;">
                <a href="${BASE}/login" style="color:#185FA5;">${BASE}/login</a>
              </td>
            </tr>
            <tr style="background:#eef2f9;">
              <td style="color:#888;font-size:13px;padding:7px 10px;">Email</td>
              <td style="font-weight:600;padding:7px 10px;">${email}</td>
            </tr>
            <tr>
              <td style="color:#888;font-size:13px;padding:7px 10px;">Password</td>
              <td style="padding:7px 10px;">
                <span style="font-size:22px;font-weight:800;color:#c0392b;letter-spacing:3px;">${tempPassword}</span>
              </td>
            </tr>
            <tr style="background:#eef2f9;">
              <td style="color:#888;font-size:13px;padding:7px 10px;">Role</td>
              <td style="font-weight:600;padding:7px 10px;text-transform:capitalize;">${role}</td>
            </tr>
          </table>
        </div>
        <div style="background:#fff8e8;border:1px solid #fac775;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
          <p style="margin:0;font-size:13px;color:#854f0b;">
            ⚠️ <strong>Important:</strong> You will be asked to change your password on first login.
          </p>
        </div>
        <a href="${BASE}/login"
           style="display:inline-block;padding:13px 32px;background:#185FA5;color:#fff;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px;">
          Login Now →
        </a>
      </div>
      <div style="background:#f8f9fc;padding:14px 28px;border-top:1px solid #e8ecf3;">
        <p style="margin:0;font-size:11px;color:#aaa;">
          Automated message from SchoolReport GES. Do not reply.
        </p>
      </div>
    </div>`,
  })
}

/* ═══════════════════════════════════════════════════════════════
   OTP — password reset code
   Fires in background.
═══════════════════════════════════════════════════════════════ */
export function sendOTPEmail({ to, fullName, otp }) {
  _sendBackground({
    to,
    subject: `${otp} — Your SchoolReport GES Reset Code`,
    html: `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e3e8f0;border-radius:14px;overflow:hidden;">
      <div style="background:#185FA5;padding:20px 28px;text-align:center;">
        <span style="color:#fff;font-size:18px;font-weight:700;">SchoolReport GES</span>
      </div>
      <div style="padding:28px;">
        <h2 style="color:#185FA5;margin:0 0 8px;">Password Reset Code</h2>
        <p style="color:#555;margin:0 0 24px;">
          Hello <strong>${fullName}</strong>, use the code below to reset your password.
        </p>
        <div style="text-align:center;background:#f4f6fb;border-radius:12px;padding:28px;margin-bottom:20px;">
          <div style="font-size:44px;font-weight:900;letter-spacing:12px;color:#185FA5;">${otp}</div>
          <p style="margin:12px 0 0;font-size:13px;color:#888;">
            This code expires in <strong>10 minutes</strong>
          </p>
        </div>
        <div style="background:#fff8e8;border:1px solid #fac775;border-radius:8px;padding:12px 16px;">
          <p style="margin:0;font-size:13px;color:#854f0b;">
            ⚠️ If you did not request this, ignore this email.
          </p>
        </div>
      </div>
      <div style="background:#f8f9fc;padding:12px 28px;border-top:1px solid #e8ecf3;">
        <p style="margin:0;font-size:11px;color:#aaa;">Automated message from SchoolReport GES. Do not reply.</p>
      </div>
    </div>`,
  })
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN RESET — admin force-resets a user's password
   Fires in background.
═══════════════════════════════════════════════════════════════ */
export function sendAdminResetEmail({ to, fullName, newPassword, schoolName }) {
  const BASE = process.env.FRONTEND_URL || 'http://localhost:5173'

  _sendBackground({
    to,
    subject: `Password Reset — ${schoolName}`,
    html: `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e3e8f0;border-radius:14px;overflow:hidden;">
      <div style="background:#185FA5;padding:20px 28px;text-align:center;">
        <span style="color:#fff;font-size:18px;font-weight:700;">SchoolReport GES</span>
      </div>
      <div style="padding:28px;">
        <h2 style="color:#185FA5;margin:0 0 8px;">Your Password Was Reset</h2>
        <p style="color:#555;margin:0 0 20px;">
          Hello <strong>${fullName}</strong>, an administrator at
          <strong>${schoolName}</strong> has reset your password.
        </p>
        <div style="background:#f4f6fb;border-radius:10px;padding:20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="color:#888;font-size:13px;padding:6px 10px;">New Password</td>
              <td style="font-size:22px;font-weight:800;color:#c0392b;letter-spacing:3px;padding:6px 10px;">
                ${newPassword}
              </td>
            </tr>
          </table>
        </div>
        <div style="background:#fcebeb;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
          <p style="margin:0;font-size:13px;color:#c0392b;">
            ⚠️ You must change your password immediately after logging in.
          </p>
        </div>
        <a href="${BASE}/login"
           style="display:inline-block;padding:12px 28px;background:#185FA5;color:#fff;border-radius:9px;text-decoration:none;font-weight:700;">
          Login Now →
        </a>
      </div>
      <div style="background:#f8f9fc;padding:12px 28px;border-top:1px solid #e8ecf3;">
        <p style="margin:0;font-size:11px;color:#aaa;">Automated message from SchoolReport GES. Do not reply.</p>
      </div>
    </div>`,
  })
}
