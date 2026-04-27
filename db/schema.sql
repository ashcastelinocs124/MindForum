-- MindForum schema. Idempotent — safe to re-run.
-- Versioning: each migration inserts a row into schema_migrations.
-- Keep tables room-scoped; everything cascades from rooms.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version      INTEGER PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  system_prompt   TEXT NOT NULL DEFAULT '',
  created_by_id   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  id         TEXT NOT NULL,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, room_id)
);

-- Prevent duplicate joins when the same user races two join requests
-- before the cookie lands. Email is case-folded at insert time.
CREATE UNIQUE INDEX IF NOT EXISTS participants_room_email_uniq
  ON participants (room_id, lower(email));

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'chat',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_room_created_idx
  ON messages (room_id, created_at);

CREATE TABLE IF NOT EXISTS room_files (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  uploaded_by_id  TEXT NOT NULL,
  extracted_text  TEXT NOT NULL DEFAULT '',
  selected        BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS room_files_room_uploaded_idx
  ON room_files (room_id, uploaded_at);

INSERT INTO schema_migrations (version) VALUES (1)
  ON CONFLICT (version) DO NOTHING;

-- v2: per-participant last_seen_at for catch-up modal
ALTER TABLE participants ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES (2)
  ON CONFLICT (version) DO NOTHING;
