# SchoolReport GES

Ghana Education Service automated report system: score entry, GES grading (A1–F9) and printable terminal reports.
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

`student` logins exist but are not yet linked to a student record, so they can only see the
dashboard.

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
| GET | `/health` | anyone (also checks the database) |

Score reads use the school's current academic year; add `?academicYear=2025/2026` for another year.

---

## ☁️ Deploying

- **Backend** (Render/Railway): root directory `schoolreport-ges-backend-fixed`, build `npm install`,
  start `npm start`. Set `DATABASE_URL`, `JWT_SECRET`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`,
  `NODE_ENV=production`, `FRONTEND_URL`, `CORS_ORIGINS`, and the `SMTP_*` values.
- **Frontend** (Vercel): root directory `schoolreport-ges-v3`; set `VITE_API_URL` to the backend's
  address ending in `/api`.

---

## 🔜 Next steps

- [ ] Link student logins to a student record so students can see their own report
- [ ] Choose a past academic year on the Scores and Reports pages (the API already supports it)
- [ ] Affective skills & psychomotor scoring; class teacher / head teacher remarks
- [ ] PDF export of reports
- [ ] Bulk student import from Excel/CSV (the `/students/bulk` endpoint exists)
- [ ] Class promotion at the end of the year
