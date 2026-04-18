# SchoolReport GES — Full Stack Microservices

Ghana Education Service Automated Report System  
**React + Node.js + Express + MongoDB**

---

## 📁 Project Structure

```
schoolreport-ges/          ← React frontend (Vite)
schoolreport-ges-backend/  ← Backend microservices (Node.js)
  ├── gateway/             ← API Gateway (port 3000)
  └── services/
      ├── auth/            ← Auth Service (port 3001)
      ├── school/          ← School Service (port 3002)
      ├── students/        ← Students Service (port 3003)
      └── reports/         ← Reports/Scores Service (port 3004)
```

---

## 🏗️ Architecture

```
React App (port 5173)
      │
      ▼  /api/*
API Gateway (port 3000)
      │
      ├──▶ Auth Service    (3001)  — Login, JWT, User CRUD
      ├──▶ School Service  (3002)  — Settings, Classes, Subjects, MaxMarks
      ├──▶ Students Service(3003)  — Student CRUD per class
      └──▶ Reports Service (3004)  — Scores entry, Report generation
```

---

## 📡 Full API Reference (24 endpoints)

### Auth Service — `http://localhost:3001`
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/auth/login` | ❌ | — | Login, returns JWT |
| GET | `/auth/me` | ✅ | any | Get current user |
| GET | `/users` | ✅ | admin | List all users |
| POST | `/users` | ✅ | admin | Create user |
| PUT | `/users/:id` | ✅ | admin | Update user |
| DELETE | `/users/:id` | ✅ | admin | Delete user |

### School Service — `http://localhost:3002`
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/settings` | ✅ | any | Get school settings |
| PUT | `/settings` | ✅ | admin/head | Update school settings |
| GET | `/stats` | ✅ | any | Dashboard counts |
| GET | `/classes` | ✅ | any | List all classes |
| POST | `/classes` | ✅ | admin | Create class |
| PUT | `/classes/:id` | ✅ | admin | Update class |
| DELETE | `/classes/:id` | ✅ | admin | Delete class |
| GET | `/subjects` | ✅ | any | List all subjects |
| POST | `/subjects` | ✅ | admin/head | Create subject |
| PUT | `/subjects/:id` | ✅ | admin/head | Update subject |
| DELETE | `/subjects/:id` | ✅ | admin/head | Delete subject |
| GET | `/max-marks` | ✅ | any | Get max class marks per subject |
| PUT | `/max-marks` | ✅ | admin/head | Set max class marks |

### Students Service — `http://localhost:3003`
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/students?classId=` | ✅ | any | List students (filtered) |
| GET | `/students/:id` | ✅ | any | Get single student |
| POST | `/students` | ✅ | any | Add student |
| POST | `/students/bulk` | ✅ | any | Bulk add students |
| PUT | `/students/:id` | ✅ | any | Update student |
| DELETE | `/students/:id` | ✅ | any | Soft-delete student |

### Reports Service — `http://localhost:3004`
| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/scores/:classId/:term` | ✅ | any | Get all scores for class/term |
| GET | `/scores/student/:studentId/:term` | ✅ | any | Get student scores |
| POST | `/scores/:classId/:term/bulk` | ✅ | any | Bulk upsert scores |
| PUT | `/scores/:id` | ✅ | any | Update single score |
| DELETE | `/scores/:classId/:term` | ✅ | admin | Clear class scores |
| GET | `/reports/student/:studentId/:term` | ✅ | any | Student report data |
| GET | `/reports/class/:classId/:term` | ✅ | any | Class report summary |

---

## 🚀 Setup & Running

### Prerequisites
- Node.js v20+
- MongoDB (local or Atlas)
- npm v9+

---

### 1. Backend Setup

```bash
cd schoolreport-ges-backend

# Copy and configure environment
cp .env.example .env
# Edit .env — set your MONGO_URI and JWT_SECRET

# Install all workspace dependencies
npm install

# Run ALL services at once (recommended)
npm run dev
```

Or run individually:
```bash
npm run dev:gateway   # port 3000
npm run dev:auth      # port 3001
npm run dev:school    # port 3002
npm run dev:students  # port 3003
npm run dev:reports   # port 3004
```

**Default admin account (auto-seeded on first run):**
- Username: `admin`
- Password: `admin123`

---

### 2. Frontend Setup

```bash
cd schoolreport-ges

npm install
npm run dev
```

Open → `http://localhost:5173`

> The Vite dev server proxies all `/api/*` requests to the gateway on `:3000`.

---

## 🔐 Auth Flow

1. User submits login form → React calls `POST /api/auth/login`
2. Gateway proxies to Auth Service → validates credentials → returns JWT
3. JWT stored in `localStorage` via Zustand store
4. Every subsequent request attaches `Authorization: Bearer <token>`
5. Each service independently verifies the JWT (no inter-service calls needed)
6. On 401, Axios interceptor clears token and redirects to `/login`

---

## 👥 Roles & Permissions

| Feature | Admin | Head Teacher | Class Teacher |
|---------|-------|-------------|----------------|
| Dashboard | ✅ | ✅ | ✅ |
| View all classes | ✅ | ✅ | ❌ |
| Manage students | ✅ | ✅ | Own class only |
| Enter scores | ✅ | ✅ | Own class only |
| Generate reports | ✅ | ✅ | Own class only |
| Manage users | ✅ | ❌ | ❌ |
| School settings | ✅ | ✅ | ❌ |
| Add/remove classes | ✅ | ❌ | ❌ |
| Add/remove subjects | ✅ | ✅ | ❌ |

---

## 🗄️ MongoDB Collections

| Collection | Service | Description |
|-----------|---------|-------------|
| `users` | Auth | Staff accounts |
| `settings` | School | School config (singleton) |
| `classes` | School | Class definitions |
| `subjects` | School | Subject definitions |
| `maxmarks` | School | Max class score per subject |
| `students` | Students | Student roster |
| `scores` | Reports | Score entries per student/subject/term |

---

## 🔜 Next Steps (Phase 2)

- [ ] Affective skills & psychomotor scoring
- [ ] PDF export of reports (using Puppeteer)
- [ ] Bulk student import from Excel/CSV
- [ ] Class promotion (end of year)
- [ ] SMS/email notifications to parents
- [ ] Docker Compose for one-command deployment
- [ ] Redis caching on the gateway
- [ ] Rate limiting & request logging
