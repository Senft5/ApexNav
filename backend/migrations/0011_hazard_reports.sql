-- Hazards reported by hand (IDEAS Q-15) and "still there?" votes (Q-16). backend/src/hazards.ts, docs/BACKEND.md.
-- Members see a report's kind, place, heading and how many confirmed it, never who reported it. Reports expire by kind
-- and each confirmation pushes the expiry out; the daily sweep deletes them a day after they expire.
CREATE TABLE hazard_reports (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('pothole','gravel','debris','animal','police','closure')),
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  heading     INTEGER,                                    -- degrees the reporter was travelling, null when unknown
  reported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  confirms    INTEGER NOT NULL DEFAULT 1,
  clears      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX hazard_reports_place ON hazard_reports(lat, lon);
CREATE INDEX hazard_reports_by ON hazard_reports(reported_by, created_at);
CREATE TABLE hazard_votes (
  hazard_id TEXT NOT NULL REFERENCES hazard_reports(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  still     INTEGER NOT NULL CHECK (still IN (0, 1)),
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (hazard_id, user_id)
) WITHOUT ROWID;
