-- School logo, shown on printed reports and in the app. Small images only: the browser
-- resizes to at most 512 px before upload, the server checks the real file type and size.
-- Kept in its own table so reading settings never loads the image bytes.
CREATE TABLE school_logos (
  school_id    uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data         bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 524288),
  width        integer NOT NULL CHECK (width BETWEEN 16 AND 2048),
  height       integer NOT NULL CHECK (height BETWEEN 16 AND 2048),
  sha256       text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
