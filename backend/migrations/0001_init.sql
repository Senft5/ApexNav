-- ApexNav D1 (SQLite) schema, migration 0001. See docs/BACKEND.md.
-- Access model: phones never talk to the database. Only the Worker API does, and every query is scoped
-- by the authenticated user in one place (backend/src/auth + data access layer), covered by tests.
PRAGMA foreign_keys = ON;

-- ---- identity, invites, sessions -------------------------------------------------------------
CREATE TABLE users (
  id           TEXT PRIMARY KEY,                       -- uuid
  google_sub   TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL,
  handle       TEXT UNIQUE,                            -- exact-match search only
  display_name TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Membership: a user is a member only after redeeming an invite (anyone can sign in with Google; not everyone is let in).
CREATE TABLE members (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  contribute INTEGER NOT NULL DEFAULT 0                -- opt-in to road-data contribution
);
CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,                         -- sha256 of the token; the token itself is never stored
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at    TEXT
);
CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,                         -- sha256 of the session token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- ---- social ----------------------------------------------------------------------------------
CREATE TABLE friendships (
  user_a       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),                             -- canonical ordered pair
  CHECK (requested_by IN (user_a, user_b))
);
CREATE INDEX friendships_b ON friendships(user_b);
CREATE TABLE blocks (
  blocker TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker, blocked)
);
CREATE TABLE crews (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE crew_members (
  crew_id   TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (crew_id, user_id)
);
CREATE INDEX crew_members_user ON crew_members(user_id);
CREATE TABLE crew_invites (
  token_hash TEXT PRIMARY KEY,
  crew_id    TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- ---- segments, opt-in sharing, boards --------------------------------------------------------
CREATE TABLE segments (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  length_m   REAL NOT NULL,
  geom       TEXT NOT NULL,                            -- encoded polyline
  start_lat  REAL NOT NULL, start_lon REAL NOT NULL,
  end_lat    REAL NOT NULL, end_lon   REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX segments_owner ON segments(owner);
-- One row per friend / per crew the owner chose to share with. No row = nothing shared.
CREATE TABLE grants (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('friend','crew')),
  audience_id   TEXT NOT NULL,                         -- friend's user id or crew id
  share_scores  INTEGER NOT NULL DEFAULT 0,
  share_times   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, audience_type, audience_id)
);
-- Snapshots published to ONE audience. Written only by the publish endpoint, which requires a matching grant.
CREATE TABLE board_entries (
  id            TEXT PRIMARY KEY,
  segment_id    TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('friend','crew')),
  audience_id   TEXT NOT NULL,
  driver_score  INTEGER NOT NULL CHECK (driver_score BETWEEN 0 AND 1000),
  time_s        INTEGER,                               -- NULL unless share_times
  driven_on     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (segment_id, user_id, audience_type, audience_id, driven_on)
);
CREATE INDEX board_audience ON board_entries(audience_type, audience_id, segment_id);
CREATE TABLE shared_routes (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  geom       TEXT NOT NULL,                            -- planned route only, never a recorded drive
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---- crowd road data (docs/BACKEND.md sections 3, 4, 11) -------------------------------------
CREATE TABLE road_bins (                               -- merged, anonymous; no updated_at
  way_id      INTEGER NOT NULL,
  dir         INTEGER NOT NULL,
  bin_idx     INTEGER NOT NULL,
  n           INTEGER NOT NULL,
  camber_mean REAL, camber_m2 REAL,
  rough_mean  REAL, rough_m2  REAL,
  crest_peak  REAL,
  PRIMARY KEY (way_id, dir, bin_idx)
) WITHOUT ROWID;
CREATE TABLE hazard_obs (
  way_id INTEGER NOT NULL, dir INTEGER NOT NULL, bin_idx INTEGER NOT NULL,
  kind   TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, passes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (way_id, dir, bin_idx, kind)
) WITHOUT ROWID;
-- Uploads wait here (at most 14 days) so first/second place survives late, offline uploads. Never readable via the API.
CREATE TABLE ingest_pending (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  way_id      INTEGER NOT NULL, dir INTEGER NOT NULL,
  driven_on   TEXT NOT NULL,
  km          REAL NOT NULL,
  bins        TEXT NOT NULL,                           -- JSON per-bin vectors (incl. curvature for the geometry check)
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pending_way ON ingest_pending(way_id, dir, driven_on);
CREATE TABLE rank_slots (                              -- at most two rows per way+direction; frozen 14 days after the first drive
  way_id INTEGER NOT NULL, dir INTEGER NOT NULL, slot INTEGER NOT NULL CHECK (slot IN (1,2)),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE, -- nulled by the nightly job once frozen
  driven_on TEXT NOT NULL,
  PRIMARY KEY (way_id, dir, slot)
);
CREATE TABLE seen (h BLOB PRIMARY KEY);                -- hmac(server_pepper, user||way||dir): dedupe without a readable who-drove-what list
CREATE TABLE points_ledger (                           -- the only thing that touches points totals; changes weekly
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  iso_week TEXT NOT NULL,
  octane   REAL NOT NULL,
  PRIMARY KEY (user_id, iso_week)
);

-- ---- highlights ------------------------------------------------------------------------------
CREATE TABLE highlights (
  id         TEXT PRIMARY KEY,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,   -- never shown to other users
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,                            -- overlook, bridge, cafe, trailhead, ...
  note       TEXT,
  lat        REAL NOT NULL, lon REAL NOT NULL,
  photo_key  TEXT,                                     -- R2 object key
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX highlights_lat ON highlights(lat);
CREATE INDEX highlights_lon ON highlights(lon);
CREATE TABLE highlight_ratings (
  highlight_id TEXT NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars        INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  visited      INTEGER NOT NULL DEFAULT 0,             -- set when the rater's own drive passed within ~150 m (proved on the phone)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (highlight_id, user_id)
);
CREATE TABLE reports (
  id         TEXT PRIMARY KEY,
  reporter   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL, target_id TEXT NOT NULL, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
