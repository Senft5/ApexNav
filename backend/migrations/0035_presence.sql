-- Friends on the map (docs/design/REVIEW.md 5.4, roadmap 24). A row only while you share: turning sharing off deletes it
-- with your samples and zones. Samples are stored already snapped to the grid when you chose "within a mile", so the exact
-- position never reaches the database; they're kept only as long as the delay needs (backend/src/presence.ts).
CREATE TABLE presence_settings (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('crew', 'friends')),
  delay_s  INTEGER NOT NULL CHECK (delay_s IN (0, 600, 3600)),
  fuzz     INTEGER NOT NULL CHECK (fuzz IN (0, 1)),
  zones    TEXT NOT NULL DEFAULT '[]',                     -- your home zones [{ "lat", "lon", "r" }], never shown to anyone
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE presence_samples (
  user_id TEXT NOT NULL REFERENCES presence_settings(user_id) ON DELETE CASCADE,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  lat     REAL NOT NULL,
  lon     REAL NOT NULL,
  road    TEXT,                                            -- only with Live and Exact
  PRIMARY KEY (user_id, at)
);
