# SchoolReport GES

School management for Ghanaian basic schools, run as a service: daily attendance register, score entry,
terminal reports with each school's grading scale (NaCCA proficiency levels by default), parents by phone
and SMS, school fees with receipts and MoMo, and self sign-up with a free trial.
**React + Node.js + Express + PostgreSQL**

---

## 📁 Project structure

```
schoolreport-ges-v3/              ← React frontend (Vite)
schoolreport-ges-backend-fixed/   ← Backend: one Express server, code split into modules
  ├── gateway/src/                ← server entry: app.js (routes), index.js (start), migrate.js
  ├── shared/                     ← database pool, migrations, auth checks, HTTP helpers
  │   └── migrations/*.sql        ← database schema, applied in order on startup
  ├── services/
  │   ├── auth/      ← login, password reset, users, superadmin console
  │   ├── school/    ← settings, classes, subjects, max marks, dashboard stats
  │   ├── students/  ← student roster
  │   └── reports/   ← scores and reports
  └── test/api.test.js            ← end-to-end API tests
```

All modules run inside **one** server process on port 3000 (a "modular monolith"); the
frontend calls it under `/api/*`.

---

## 🚀 Running locally

**Prerequisites:** Node.js 20+, PostgreSQL 13+ (local install or Docker).

### 1. Database

Any PostgreSQL works. With Docker:

```bash
docker run -d --name schoolreport-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=schoolreport -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=schoolreport \
  postgres:16-alpine
```

### 2. Backend

```bash
cd schoolreport-ges-backend-fixed
cp .env.example .env      # set DATABASE_URL and JWT_SECRET at least
npm install
npm run dev               # creates the tables on first start, then listens on :3000
```

On first start a **superadmin** is created from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.
In development, if no password is set, it uses `SuperAdmin@2024!` and asks you to change it at
first login. **In production `SUPERADMIN_PASSWORD` is required** (the default above is public).

### 3. Frontend

```bash
cd schoolreport-ges-v3
npm install
npm run dev               # http://localhost:5173 — /api is forwarded to :3000
```

### Tests

The tests run the real API against a PostgreSQL database that they **wipe**, so its name
must end in `_test`:

```bash
createdb schoolreport_test   # or: CREATE DATABASE schoolreport_test;
TEST_DATABASE_URL=postgres://schoolreport:change-me@localhost:5432/schoolreport_test npm test
```

---

## 🗄️ Database

Schema: [`shared/migrations/001_init.sql`](shared/migrations/001_init.sql).

| Table | Holds |
|-------|-------|
| `schools` | One row per school on the platform |
| `school_settings` | Name, circuit/district/region, head teacher, current academic year and term |
| `users` | Logins (superadmin, admin, head, teacher, student) |
| `classes` | Classes per school |
| `subjects` | Subjects per school, with the class-score maximum (`max_class_score`) |
| `students` | The student roster (not logins) |
| `scores` | One row per student × subject × **academic year** × term |

**Changing the schema:** add a new file such as `002_add_remarks.sql`. Never edit a migration
that has already run in production. Migrations run automatically on startup (and with
`npm run migrate`), each one once, inside a transaction.

---

## 🔐 Auth and permissions

1. `POST /api/auth/login` returns a JWT (valid 7 days by default), stored in the browser.
2. Every request sends `Authorization: Bearer <token>`.
3. On each request the server re-reads the user from the database, so deactivating a user or
   school, or changing someone's role or class, takes effect immediately.
4. New users get a temporary password and must change it before using anything else.
5. Password reset: a 6-digit code by email, valid 10 minutes, cancelled after 5 wrong tries.
   Login and reset endpoints are rate-limited per IP.

| Feature | Admin | Head Teacher | Class Teacher |
|---------|:-----:|:------------:|:-------------:|
| Dashboard | ✅ | ✅ | ✅ |
| See all classes | ✅ | ✅ | own class |
| Add/edit students | ✅ | ✅ | own class |
| Remove students | ✅ | ✅ | ❌ |
| Enter scores | ✅ | ✅ | own class |
| Reports | ✅ | ✅ | own class |
| Manage users | ✅ | ❌ | ❌ |
| School settings, subjects, max marks | ✅ | ✅ | ❌ |
| Add/remove classes | ✅ | ❌ | ❌ |

**Student / parent logins** are linked to exactly one student record (User Mgmt → role
"Student / Parent" → class → student). They see only **My Report**: that student's own marks for
each term, plus their position in the class — the ranking is computed on the server, so no
classmate's marks ever reach the browser. Removing the student deactivates the login.

---

## 📡 API (all under `/api`)

| Method | Path | Who |
|--------|------|-----|
| POST | `/auth/login` · `/auth/forgot-password` · `/auth/verify-otp` · `/auth/reset-password` | anyone |
| GET | `/auth/me` · POST `/auth/change-password` | signed in |
| GET/POST | `/superadmin/schools` · PUT `/superadmin/schools/:id/toggle` | superadmin |
| GET/POST | `/users` · PUT/DELETE `/users/:id` · POST `/users/:id/reset-password` | admin |
| GET/PUT | `/school/settings` | read: school users · write: admin, head |
| GET | `/school/stats` · `/school/classes` · `/school/subjects` · `/school/max-marks` | school users |
| POST/PUT/DELETE | `/school/classes[/:id]` | admin |
| POST/PUT/DELETE | `/school/subjects[/:id]` · PUT `/school/max-marks` | admin, head |
| GET/POST | `/students` · `/students/:id` · POST `/students/bulk` · PUT/DELETE `/students/:id` | see table above |
| GET | `/scores/:classId/:term` · `/scores/student/:studentId/:term` | staff |
| POST | `/scores/:classId/:term/bulk` | staff (teachers: own class) |
| PUT | `/scores/:id` · DELETE `/scores/:classId/:term` (admin) | staff |
| GET | `/reports/class/:classId/:term` · `/reports/student/:studentId/:term` | staff |
| GET | `/reports/school/:schoolId/analytics` | admin, head, superadmin |
| GET | `/reports/me?term=&studentId=` | student logins: own report; parents: their child's (card only, ranking computed server-side) |
| GET | `/reports/cards/:classId/:term` · GET/PUT `/reports/remarks/:classId/:term` | staff (head's remark: head, admin) |
| GET | `/attendance/overview` (admin, head) · `/attendance/:classId?day=` · `/attendance/:classId/register?term=` | staff |
| PUT/DELETE | `/attendance/:classId/:day` | teachers: today + 7 days back, edit same day; head/admin: any day; delete: head/admin |
| GET/POST | `/messages/usage` · `/messages/notices` · `/messages/results/:classId/:term` | admin, head |
| * | `/fees/items` · `/fees/bill` · `/fees/charges` · `/fees/classes/:id` · `/fees/students/:id` · `/fees/payments` · `/fees/summary` · `/fees/reminders` | admin, bursar (head: read) |
| POST | `/auth/parent/request-code` · `/auth/parent/verify` | anyone (parents sign in by SMS code) |
| GET/POST | `/parent/children` · `/parent/children/:id/attendance\|fees` · `/parent/children/:id/fees/pay` · `/parent/notices` | parents |
| POST | `/signup/start` · `/signup/verify` | anyone (new school, free trial) |
| GET/POST | `/billing` · `/billing/pay` | admin (head: read) |
| GET / POST | `/payments/paystack/verify/:reference` (payer) · `/payments/paystack/webhook` (Paystack, signed) | |
| PUT/POST | `/superadmin/schools/:id/billing` · `/superadmin/schools/:id/payments` | superadmin |
| GET | `/school/logo` | school users · PUT (raw PNG/JPEG/WebP ≤ 512 KB) and DELETE: admin, head |
| GET | `/audit?limit=&before=&action=&targetType=&targetId=` | admin (own school), superadmin (all) |
| GET | `/health` (database check) · `/health/live` (process only) | anyone |

Score reads use the school's current academic year; add `?academicYear=2025/2026` for another year.

---

## 🛡️ Production behaviour

- **Audit log** (`audit_log` table, `GET /api/audit`): who changed what and when — users, settings,
  classes, subjects, students, every changed or cleared mark (old → new), logo, password changes.
- **Sessions**: changing or resetting a password signs out every other session at once.
- **Logs**: one JSON line per request with a request id (`X-Request-Id`); server errors return a
  short reference the user can quote. Passwords, tokens and reset codes are never logged.
- **Refuses to start** in production with unsafe settings (short `JWT_SECRET`, no `CORS_ORIGINS`,
  database without TLS).
- Security headers (helmet), per-IP rate limits, `Cache-Control: no-store` on personal data,
  optional CloudFront origin check (`ORIGIN_VERIFY_SECRET`).
- **Docker image**: `Dockerfile` (Node 24, non-root, health check, RDS CA bundle in `certs/`).

## ☁️ Deploying

- **Backend** (AWS: EC2 + RDS PostgreSQL + CloudFront): see [`../infra/README.md`](../infra/README.md).
- **Frontend** (Vercel): root directory `schoolreport-ges-v3`; set `VITE_API_URL` to the API address
  ending in `/api`.
- **CI**: `.github/workflows/ci.yml` runs the API tests against PostgreSQL and builds the frontend on
  every push and pull request.

---

## 🔜 Next steps

- [x] Link student logins to a student record so students can see their own report
- [x] Daily attendance register (roll call + quick list, works offline), term register printout
- [x] Conduct / attitude / interest and remarks; grading scale per school; broadsheet; print all reports
- [x] Import pupils from Excel/CSV
- [x] Parents by phone + SMS code; absence alerts, notices, results and fee reminders by SMS
- [x] School fees: items, billing, receipts, voiding, MoMo online payment (Paystack subaccounts)
- [x] Self sign-up, free trial, per-term subscription, read-only after non-payment
- [ ] Choose a past academic year on the Scores and Reports pages (the API already supports it)
- [ ] Class promotion at the end of the year
- [ ] Staff attendance; timetable; lesson notes
