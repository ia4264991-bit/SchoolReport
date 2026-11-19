-- Running as a service: schools sign themselves up, get a free trial, then pay per term.
--   complimentary: set up by the platform, never locked (the schools that existed before)
--   trial:         self sign-up, free until trial_ends_at
--   paid:          paid until paid_until
-- After the trial or paid period (plus a grace period) a school becomes read-only:
-- it can still view and print everything, but not change anything until it renews.
ALTER TABLE schools
  ADD COLUMN plan              text NOT NULL DEFAULT 'complimentary' CHECK (plan IN ('complimentary', 'trial', 'paid')),
  ADD COLUMN trial_ends_at     timestamptz,
  ADD COLUMN paid_until        date,
  ADD COLUMN phone             text CHECK (phone ~ '^\+233[0-9]{9}$'),
  ADD COLUMN signup_source     text NOT NULL DEFAULT 'superadmin' CHECK (signup_source IN ('superadmin', 'self')),
  ADD COLUMN terms_accepted_at timestamptz;

-- A sign-up waits here until the email code is confirmed. The password is already hashed.
CREATE TABLE signup_requests (
  email         text PRIMARY KEY CHECK (email = lower(email)),
  data          jsonb NOT NULL,
  password_hash text NOT NULL,
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  sent_count    integer NOT NULL DEFAULT 1,
  window_start  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  amount           numeric(10,2) NOT NULL CHECK (amount >= 0),
  pupils           integer NOT NULL DEFAULT 0,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  method           text NOT NULL CHECK (method IN ('online', 'manual')),
  reference        text UNIQUE,
  note             text NOT NULL DEFAULT '',
  recorded_by_name text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_payments_school_idx ON subscription_payments (school_id, created_at DESC);
