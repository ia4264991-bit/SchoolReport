-- Student logins: a user with role 'student' is linked to exactly one student record, so the
-- student (or their parent) can see that student's own report — and nothing else.
ALTER TABLE users ADD COLUMN student_id uuid REFERENCES students(id) ON DELETE SET NULL;

-- One login per student.
CREATE UNIQUE INDEX users_student_id_key ON users (student_id) WHERE student_id IS NOT NULL;

-- Only student logins may carry a student link.
ALTER TABLE users ADD CONSTRAINT users_student_link_role CHECK (student_id IS NULL OR role = 'student');
