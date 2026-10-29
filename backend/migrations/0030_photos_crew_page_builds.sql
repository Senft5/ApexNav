-- Design phase 4 (docs/design/REVIEW.md 5.2, 5.3; roadmap 19, 20, 23): photos, the crew page, build threads.

-- Photos: the row here, the JPEG in KV (PHOTOS, key p/<id>). backend/src/photos.ts.
CREATE TABLE photos (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('profile', 'car', 'crew', 'crest', 'post')),
  ref_id     TEXT,                                      -- the car, crew or post it belongs to (NULL for a profile photo)
  bytes      INTEGER NOT NULL,
  w          INTEGER NOT NULL,
  h          INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX photos_owner ON photos(owner);
CREATE INDEX photos_ref ON photos(kind, ref_id);
ALTER TABLE users ADD COLUMN photo_id TEXT;
ALTER TABLE cars ADD COLUMN cover_photo_id TEXT;

-- The crew page (roadmap 20): a cover, a crest, a motto, a stripe colour (Plain livery), a pinned route.
ALTER TABLE crews ADD COLUMN cover_photo_id TEXT;
ALTER TABLE crews ADD COLUMN crest_photo_id TEXT;
ALTER TABLE crews ADD COLUMN motto TEXT;
ALTER TABLE crews ADD COLUMN stripe TEXT;              -- '#rrggbb', the livery's colour
ALTER TABLE crews ADD COLUMN pinned_route_id TEXT REFERENCES shared_routes(id) ON DELETE SET NULL;

-- Crew chat: short messages for the crew's members, kept 30 days (backend/src/sweep.ts).
CREATE TABLE crew_chat (
  id         TEXT PRIMARY KEY,
  crew_id    TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  author     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX crew_chat_crew ON crew_chat(crew_id, created_at);

-- Build threads (roadmap 23): one per car; stages are its table of contents; posts numbered; replies and suggestions.
CREATE TABLE builds (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  car_id     TEXT NOT NULL UNIQUE REFERENCES cars(id) ON DELETE CASCADE,
  stages     TEXT NOT NULL DEFAULT '[]',                -- JSON ["Suspension", "Brakes", ...]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE build_posts (
  id         TEXT PRIMARY KEY,
  build_id   TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  n          INTEGER NOT NULL,
  stage      INTEGER,                                   -- index into builds.stages
  title      TEXT NOT NULL,
  body       TEXT,
  parts      TEXT NOT NULL DEFAULT '[]',                -- JSON ["Ohlins DFV R&T", ...]
  score      INTEGER,                                   -- the Vetta Score of the drive it was tested on, if the owner added one
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (build_id, n)
);
CREATE TABLE build_replies (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES build_posts(id) ON DELETE CASCADE,
  author     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  suggestion INTEGER NOT NULL DEFAULT 0,
  tried      TEXT,                                      -- the owner's "Tried it" result on a suggestion
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX build_replies_post ON build_replies(post_id, created_at);
CREATE TABLE build_follows (
  build_id   TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (build_id, user_id)
);
CREATE INDEX build_follows_user ON build_follows(user_id);
