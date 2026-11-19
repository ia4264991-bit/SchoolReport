-- Daily class register. Schools mark it once a day: one register per class per day, with
-- one mark (present / absent) per pupil. A pupil's attendance for a term is
-- "days present out of days the register was taken while they were on it".
CREATE TABLE attendance_registers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id      uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day           date NOT NULL,
  -- The school's academic year and term when the register was first taken.
  academic_year text NOT NULL,
  term          text NOT NULL CHECK (term IN ('1', '2', '3')),
  taken_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  taken_by_name text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_one_register_per_day UNIQUE (class_id, day)
);
CREATE INDEX attendance_registers_term_idx ON attendance_registers (school_id, class_id, academic_year, term, day);
CREATE INDEX attendance_registers_day_idx  ON attendance_registers (school_id, day);

CREATE TABLE attendance_marks (
  register_id uuid NOT NULL REFERENCES attendance_registers(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('present', 'absent')),
  PRIMARY KEY (register_id, student_id)
);
CREATE INDEX attendance_marks_student_idx ON attendance_marks (student_id);

CREATE TRIGGER attendance_registers_updated_at BEFORE UPDATE ON attendance_registers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
