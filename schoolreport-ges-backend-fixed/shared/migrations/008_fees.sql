-- School fees: fee items per term, charges on each pupil's account, payments with receipts.
-- A pupil's balance = all charges - all payments that were not voided.

CREATE TABLE fee_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  term          text NOT NULL CHECK (term IN ('1', '2', '3')),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  amount        numeric(10,2) NOT NULL CHECK (amount > 0),
  class_id      uuid REFERENCES classes(id) ON DELETE CASCADE,   -- NULL: every class
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fee_items_term_idx ON fee_items (school_id, academic_year, term);

CREATE TABLE fee_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year   text NOT NULL,
  term            text NOT NULL CHECK (term IN ('1', '2', '3')),
  fee_item_id     uuid REFERENCES fee_items(id) ON DELETE SET NULL, -- NULL: a one-off adjustment
  description     text NOT NULL CHECK (btrim(description) <> ''),
  amount          numeric(10,2) NOT NULL CHECK (amount <> 0),      -- negative: discount / scholarship
  created_by_name text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Billing the same fee item twice does nothing (NULL item ids never clash).
  CONSTRAINT fee_charges_once_per_item UNIQUE (student_id, fee_item_id)
);
CREATE INDEX fee_charges_student_idx ON fee_charges (student_id);
CREATE INDEX fee_charges_term_idx ON fee_charges (school_id, academic_year, term);

CREATE TABLE fee_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id         uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount             numeric(10,2) NOT NULL CHECK (amount > 0),
  method             text NOT NULL CHECK (method IN ('cash', 'momo', 'bank', 'cheque', 'online')),
  reference          text NOT NULL DEFAULT '',
  paid_on            date NOT NULL,
  receipt_no         text NOT NULL,
  note               text NOT NULL DEFAULT '',
  -- The school's academic year and term when the money came in (term collection reports).
  academic_year      text NOT NULL,
  term               text NOT NULL CHECK (term IN ('1', '2', '3')),
  received_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  received_by_name   text NOT NULL DEFAULT '',
  paystack_reference text UNIQUE,
  voided_at          timestamptz,
  voided_by_name     text,
  void_reason        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_payments_receipt_unique UNIQUE (school_id, receipt_no)
);
CREATE INDEX fee_payments_student_idx ON fee_payments (student_id);
CREATE INDEX fee_payments_term_idx ON fee_payments (school_id, academic_year, term);

-- Per-school running numbers (receipt numbers).
CREATE TABLE school_counters (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name      text NOT NULL,
  value     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, name)
);

-- Online payments through Paystack: school fees (paid by parents, settled straight to the
-- school's own Paystack subaccount) and the platform subscription (paid by the school).
CREATE TABLE online_payments (
  reference      text PRIMARY KEY,
  purpose        text NOT NULL CHECK (purpose IN ('fees', 'subscription')),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id     uuid REFERENCES students(id) ON DELETE SET NULL,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  amount_pesewas integer NOT NULL CHECK (amount_pesewas > 0),
  currency       text NOT NULL DEFAULT 'GHS',
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  channel        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX online_payments_school_idx ON online_payments (school_id, created_at DESC);

-- The school's Paystack subaccount code (e.g. ACCT_xxxx): online fee payments settle to it.
ALTER TABLE schools ADD COLUMN paystack_subaccount text CHECK (paystack_subaccount ~ '^ACCT_[A-Za-z0-9]+$');
