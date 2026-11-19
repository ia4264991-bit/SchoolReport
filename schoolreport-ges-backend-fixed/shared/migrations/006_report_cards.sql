-- Grading scale and class-score weight per school, and the parts of the terminal report
-- that are written by hand (conduct, attitude, interest, remarks, promotion).

-- Bands, highest first; the last band starts at 0. Default: NaCCA's proficiency levels for
-- the standards-based curriculum (KG to Basic 6).
ALTER TABLE school_settings
  ADD COLUMN grading_scale jsonb NOT NULL DEFAULT '{"preset":"nacca","bands":[
      {"min":80,"grade":"HP","remark":"Highly Proficient"},
      {"min":68,"grade":"P","remark":"Proficient"},
      {"min":54,"grade":"AP","remark":"Approaching Proficiency"},
      {"min":40,"grade":"D","remark":"Developing"},
      {"min":0,"grade":"E","remark":"Emerging"}]}'::jsonb,
  -- Share of the subject total that comes from the class score; the exam gives the rest.
  ADD COLUMN class_score_weight smallint NOT NULL DEFAULT 40 CHECK (class_score_weight BETWEEN 0 AND 100);

CREATE TABLE report_remarks (
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year  text NOT NULL,
  term           text NOT NULL CHECK (term IN ('1', '2', '3')),
  conduct        text NOT NULL DEFAULT '',
  attitude       text NOT NULL DEFAULT '',
  interest       text NOT NULL DEFAULT '',
  teacher_remark text NOT NULL DEFAULT '',
  head_remark    text NOT NULL DEFAULT '',
  promoted_to    text NOT NULL DEFAULT '',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, academic_year, term)
);
CREATE INDEX report_remarks_school_idx ON report_remarks (school_id, academic_year, term);
CREATE TRIGGER report_remarks_updated_at BEFORE UPDATE ON report_remarks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
