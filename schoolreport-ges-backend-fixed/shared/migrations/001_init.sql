-- SchoolReport GES: initial PostgreSQL schema (replaces the old MongoDB collections).
-- Needs PostgreSQL 13+ (gen_random_uuid() is built in).
-- Every school-owned row carries school_id; the API always filters by the caller's school.

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

-- ── Schools (one row per school on the platform) ──────────────────────────
CREATE TABLE schools (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  email      text NOT NULL UNIQUE CHECK (email = lower(email)),
  circuit    text NOT NULL DEFAULT '',
  district   text NOT NULL DEFAULT '',
  region     text NOT NULL DEFAULT '',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Settings (exactly one per school) ─────────────────────────────────────
CREATE TABLE school_settings (
  school_id      uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  school_name    text NOT NULL DEFAULT 'My School',
  circuit        text NOT NULL DEFAULT '',
  district       text NOT NULL DEFAULT '',
  region         text NOT NULL DEFAULT '',
  head_teacher   text NOT NULL DEFAULT '',
  academic_year  text NOT NULL CHECK (btrim(academic_year) <> ''),
  term           text NOT NULL DEFAULT '1' CHECK (term IN ('1', '2', '3')),
  next_term_date date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Classes ───────────────────────────────────────────────────────────────
CREATE TABLE classes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (btrim(name) <> ''),
  level      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classes_school_idx ON classes (school_id, name);

-- ── Subjects ──────────────────────────────────────────────────────────────
-- max_class_score: the raw mark the class score is out of (converted to 40%).
-- NULL means "not set"; the app then treats it as 100.
CREATE TABLE subjects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  code            text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  max_class_score numeric(6,2) CHECK (max_class_score > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subjects_school_idx ON subjects (school_id, sort_order, name);

-- ── Users (staff and student logins) ──────────────────────────────────────
-- A superadmin has no school; every other role must belong to one.
CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name            text NOT NULL CHECK (btrim(full_name) <> ''),
  email                text NOT NULL UNIQUE CHECK (email = lower(email)),
  username             text UNIQUE,
  password_hash        text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('superadmin', 'admin', 'head', 'teacher', 'student')),
  school_id            uuid REFERENCES schools(id) ON DELETE CASCADE,
  class_id             uuid REFERENCES classes(id) ON DELETE SET NULL,
  notes                text NOT NULL DEFAULT '',
  is_active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  -- Password-reset code: stored as an HMAC, never in plain text.
  otp_hash             text,
  otp_expires_at       timestamptz,
  otp_attempts         integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_school_matches_role CHECK ((role = 'superadmin') = (school_id IS NULL))
);
CREATE INDEX users_school_idx ON users (school_id);
CREATE INDEX users_class_idx  ON users (class_id) WHERE class_id IS NOT NULL;

-- ── Students (the roster; not logins) ─────────────────────────────────────
-- class_id becomes NULL if a class is deleted; the API refuses to delete a class
-- that still has active students.
CREATE TABLE students (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id      uuid REFERENCES classes(id) ON DELETE SET NULL,
  full_name     text NOT NULL CHECK (btrim(full_name) <> ''),
  gender        text NOT NULL CHECK (gender IN ('M', 'F')),
  date_of_birth date,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX students_school_class_idx ON students (school_id, class_id) WHERE is_active;

-- ── Scores (one row per student, subject, academic year and term) ─────────
-- academic_year is part of the key so a new year's Term 1 does not overwrite last year's.
CREATE TABLE scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id      uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id    uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  term          text NOT NULL CHECK (term IN ('1', '2', '3')),
  class_score   numeric(6,2) NOT NULL DEFAULT 0 CHECK (class_score >= 0),
  exam_score    numeric(5,2) NOT NULL DEFAULT 0 CHECK (exam_score >= 0 AND exam_score <= 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scores_one_per_subject UNIQUE (student_id, subject_id, academic_year, term)
);
CREATE INDEX scores_class_term_idx ON scores (school_id, class_id, academic_year, term);

-- ── Keep updated_at current ───────────────────────────────────────────────
CREATE TRIGGER schools_updated_at         BEFORE UPDATE ON schools         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER school_settings_updated_at BEFORE UPDATE ON school_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER classes_updated_at         BEFORE UPDATE ON classes         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subjects_updated_at        BEFORE UPDATE ON subjects        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at           BEFORE UPDATE ON users           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER students_updated_at        BEFORE UPDATE ON students        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER scores_updated_at          BEFORE UPDATE ON scores          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
