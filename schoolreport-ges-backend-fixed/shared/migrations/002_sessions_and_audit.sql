-- Sessions: each login token carries the user's token_version. Changing or resetting a
-- password bumps it, which signs out every other session at once.
ALTER TABLE users ADD COLUMN token_version integer NOT NULL DEFAULT 0;

-- Audit log: who changed what, and when. Rows are only ever inserted.
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  school_id   uuid REFERENCES schools(id) ON DELETE CASCADE,  -- NULL for platform-level actions
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name  text NOT NULL DEFAULT '',                          -- kept even if the user is removed
  actor_role  text NOT NULL DEFAULT '',
  action      text NOT NULL,                                     -- e.g. 'scores.save', 'user.update'
  target_type text,
  target_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  request_id  text
);
CREATE INDEX audit_log_school_at_idx ON audit_log (school_id, at DESC);
CREATE INDEX audit_log_target_idx    ON audit_log (target_type, target_id);
