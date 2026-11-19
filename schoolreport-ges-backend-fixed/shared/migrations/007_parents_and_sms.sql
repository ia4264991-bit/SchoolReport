-- Parents / guardians, phone sign-in, SMS and notices.

-- Up to two guardian phone numbers per pupil, stored as +233XXXXXXXXX.
ALTER TABLE students
  ADD COLUMN guardian_name   text NOT NULL DEFAULT '',
  ADD COLUMN guardian_phone  text CHECK (guardian_phone  ~ '^\+233[0-9]{9}$'),
  ADD COLUMN guardian_phone2 text CHECK (guardian_phone2 ~ '^\+233[0-9]{9}$');
CREATE INDEX students_guardian_phone_idx  ON students (guardian_phone)  WHERE is_active AND guardian_phone IS NOT NULL;
CREATE INDEX students_guardian_phone2_idx ON students (guardian_phone2) WHERE is_active AND guardian_phone2 IS NOT NULL;

-- New roles: parent (signs in with phone + SMS code; no email, no password) and bursar
-- (school fees only).
ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN phone text CHECK (phone ~ '^\+233[0-9]{9}$');
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'head', 'teacher', 'student', 'parent', 'bursar'));
ALTER TABLE users ADD CONSTRAINT users_login_kind CHECK (
  (role = 'parent'  AND phone IS NOT NULL AND email IS NULL AND password_hash IS NULL)
  OR (role <> 'parent' AND email IS NOT NULL AND password_hash IS NOT NULL));
CREATE UNIQUE INDEX users_parent_phone_key ON users (school_id, phone) WHERE role = 'parent';

-- Sign-in codes sent by SMS. Stored as an HMAC, never in plain text.
CREATE TABLE phone_login_codes (
  phone        text PRIMARY KEY CHECK (phone ~ '^\+233[0-9]{9}$'),
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  -- How many codes were sent since window_start (limits SMS cost and abuse).
  sent_count   integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);

-- Every SMS the platform sends (not the text: it can hold a sign-in code or personal data).
CREATE TABLE sms_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   uuid REFERENCES schools(id) ON DELETE CASCADE,   -- NULL: platform message (sign-in code)
  kind        text NOT NULL CHECK (kind IN ('login_code', 'absence', 'results', 'notice', 'fee_reminder', 'payment_receipt')),
  to_phone    text NOT NULL,
  student_id  uuid REFERENCES students(id) ON DELETE SET NULL,
  ref_day     date,
  segments    integer NOT NULL DEFAULT 1,
  status      text NOT NULL CHECK (status IN ('sent', 'failed')),
  provider    text NOT NULL,
  provider_id text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_messages_school_idx ON sms_messages (school_id, created_at DESC);
-- One absence alert per pupil, phone and day, however often the register is saved.
CREATE UNIQUE INDEX sms_messages_one_absence_alert
  ON sms_messages (student_id, to_phone, ref_day) WHERE kind = 'absence' AND status = 'sent';

ALTER TABLE school_settings ADD COLUMN sms_absence_alerts boolean NOT NULL DEFAULT false;
-- SMS cost control: segments a school may send per calendar month (set by the platform).
ALTER TABLE schools ADD COLUMN sms_monthly_limit integer NOT NULL DEFAULT 500 CHECK (sms_monthly_limit >= 0);

-- Notices from the school to parents (shown in the parent app; optionally also by SMS).
CREATE TABLE notices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id     uuid REFERENCES classes(id) ON DELETE CASCADE,     -- NULL: whole school
  title        text NOT NULL CHECK (btrim(title) <> ''),
  body         text NOT NULL CHECK (btrim(body) <> ''),
  sent_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_by_name text NOT NULL DEFAULT '',
  sms_recipients integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notices_school_idx ON notices (school_id, created_at DESC);
