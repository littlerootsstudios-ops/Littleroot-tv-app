-- LittleRoots database (Cloudflare D1 / SQLite)

-- Categories ("rows" on the home screen). is_world = also shown as a big tile.
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,            -- e.g. "bible"
  name        TEXT NOT NULL,               -- e.g. "Bible Stories"
  note        TEXT,                        -- small line next to the row title
  sort        INTEGER NOT NULL DEFAULT 0,
  is_world    INTEGER NOT NULL DEFAULT 0,
  cover_video TEXT,                        -- video id whose thumbnail is used for the tile
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Videos. source_type: 'hls' (converted files in our storage), 'youtube' (interim, while moving off YouTube), 'stream' (reserved)
CREATE TABLE videos (
  id            TEXT PRIMARY KEY,          -- slug, e.g. "noahs-ark"
  title         TEXT NOT NULL,
  description   TEXT,
  category_id   TEXT REFERENCES categories(id),
  bible_ref     TEXT,
  kind          TEXT,                      -- "Bible story", "Song", "Short · For parents" ...
  age           TEXT,                      -- "3–8", "Parents", "All ages"
  talk          TEXT NOT NULL DEFAULT '[]',-- JSON array of "Talk about it together" questions
  is_short      INTEGER NOT NULL DEFAULT 0,
  for_parents   INTEGER NOT NULL DEFAULT 0,
  bedtime       INTEGER NOT NULL DEFAULT 0,
  free          INTEGER NOT NULL DEFAULT 1, -- everything is free for now; ready for a subscribers-only option later
  featured      INTEGER NOT NULL DEFAULT 0, -- shown as the big hero on the home screen
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  source_type   TEXT CHECK (source_type IN ('stream','hls','youtube')),
  source_id     TEXT,
  thumbnail_url TEXT,
  media_path    TEXT,                       -- secret folder in storage holding the streaming files
  processing    TEXT NOT NULL DEFAULT 'none' CHECK (processing IN ('none','uploading','converting','ready','failed')),
  processing_error TEXT,
  upload_key    TEXT,                       -- original file waiting in the inbox
  pending_media_path TEXT,                  -- where the converter is writing (becomes media_path when done)
  processing_started TEXT,
  duration_s    INTEGER,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX videos_category ON videos(category_id, sort);

-- Admin accounts (only emails listed in ADMIN_EMAILS can create one).
-- Family accounts and subscriptions can be added later in a new migration.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Signed-in admin sessions. Only a hash of each token is stored.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  last_seen   TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
