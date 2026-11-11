-- Weekly time attack (docs/SOCIAL.md 2.9; the owner, 2026-11-11: "a weekly time attack circuit per area"). Members put
-- one of their own stages up for their area (a 1-degree square); each Monday (UTC) one is picked per area, and whoever
-- enters drives it in the week: their quickest time goes on a board every member can see, by handle. Additive only.
-- Undo: DROP TABLE ta_entries; DROP TABLE ta_weeks; DROP TABLE ta_pool.
CREATE TABLE ta_pool (
  segment_id  TEXT PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
  owner       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,                                   -- 'lat,lon' of the 1-degree square the stage starts in
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ta_pool_cell ON ta_pool(cell);
CREATE INDEX ta_pool_owner ON ta_pool(owner);
-- The week's pick per area, made once (the first time anyone asks) so it holds even if the pool changes.
CREATE TABLE ta_weeks (
  week        TEXT NOT NULL,                                   -- the Monday it starts, 'YYYY-MM-DD' (UTC)
  cell        TEXT NOT NULL,
  segment_id  TEXT NOT NULL,                                   -- the stage (its canonical id); no FK: a deleted stage leaves an empty week
  PRIMARY KEY (week, cell)
) WITHOUT ROWID;
CREATE INDEX ta_weeks_segment ON ta_weeks(segment_id, week);
-- One row per entrant per week: their quickest time that week, and that run's Vetta Score.
CREATE TABLE ta_entries (
  week         TEXT NOT NULL,
  cell         TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_s       INTEGER NOT NULL CHECK (time_s BETWEEN 10 AND 36000),
  driver_score INTEGER CHECK (driver_score BETWEEN 0 AND 1000),
  driven_on    TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (week, cell, user_id)
) WITHOUT ROWID;
CREATE INDEX ta_entries_user ON ta_entries(user_id);
