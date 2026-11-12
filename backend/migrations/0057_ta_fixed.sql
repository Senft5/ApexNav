-- Fixed time attacks (the owner, 2026-11-12: "time attacks should just be static best roads maybe changing every few months
-- or something or rotating highlighted time attacks, with a leaderboard that you can view by week; month; year; all time").
-- An area (time_attack.ts cellOf, a quarter degree) has up to three loops for a season (a calendar quarter), built as the
-- weekly ones were (the first phone builds each from a seed with Vetta's router, the server checks and keeps it), but over
-- the area's best roads and kept the whole season. One is featured each week, in turn. Times are kept a day at a time
-- (your quickest that day), so a board can be read for this week, month, year or all time. Entering is the opt-in, as
-- before (ta_entered, as ta_joins was). The weekly tables (0049, 0051, 0054) stay for builds that still ask for them. Additive only.
-- Undo: DROP TABLE ta_times; DROP TABLE ta_entered; DROP TABLE ta_circuits.
CREATE TABLE ta_circuits (
  id          TEXT PRIMARY KEY,                                -- "ta-" + uuid: what entrants' stage copies carry as origin_id
  season      TEXT NOT NULL,                                   -- the first day of its quarter, 'YYYY-MM-DD'
  cell        TEXT NOT NULL,
  slot        INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 2),
  name        TEXT NOT NULL,
  length_m    REAL NOT NULL,
  geom        TEXT NOT NULL,                                   -- JSON [[lat, lon], ...], back at its start
  tries       INTEGER NOT NULL DEFAULT 0,                      -- loops a moderator took down in this slot this season
  removed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (season, cell, slot)
);
CREATE INDEX ta_circuits_cell ON ta_circuits(cell, season);
CREATE TABLE ta_entered (
  circuit_id  TEXT NOT NULL REFERENCES ta_circuits(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (circuit_id, user_id)
) WITHOUT ROWID;
CREATE INDEX ta_entered_user ON ta_entered(user_id);
-- Your quickest time on a circuit each day you drove it, and that run's Vetta Score.
CREATE TABLE ta_times (
  circuit_id   TEXT NOT NULL REFERENCES ta_circuits(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driven_on    TEXT NOT NULL,
  time_s       INTEGER NOT NULL CHECK (time_s BETWEEN 10 AND 36000),
  driver_score INTEGER CHECK (driver_score BETWEEN 0 AND 1000),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (circuit_id, user_id, driven_on)
) WITHOUT ROWID;
CREATE INDEX ta_times_user ON ta_times(user_id);
CREATE INDEX ta_times_board ON ta_times(circuit_id, driven_on);
