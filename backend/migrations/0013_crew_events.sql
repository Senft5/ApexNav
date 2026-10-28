-- Crew drives (IDEAS S-06): a planned drive for one crew with a time, a meeting point, an optional planned route shared
-- with that crew (S-05), notes, and who's going. Crew members only. Past drives go a week after they start (the sweep).
CREATE TABLE crew_events (
  id         TEXT PRIMARY KEY,
  crew_id    TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  starts_at  TEXT NOT NULL,                              -- UTC 'YYYY-MM-DD HH:MM:SS'
  meet_name  TEXT,
  meet_lat   REAL NOT NULL,
  meet_lon   REAL NOT NULL,
  route_id   TEXT REFERENCES shared_routes(id) ON DELETE SET NULL,
  notes      TEXT,
  cancelled  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX crew_events_crew ON crew_events(crew_id, starts_at);
CREATE INDEX crew_events_creator ON crew_events(created_by);
CREATE TABLE crew_event_rsvps (
  event_id   TEXT NOT NULL REFERENCES crew_events(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('going','maybe','no')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
) WITHOUT ROWID;
CREATE INDEX crew_event_rsvps_user ON crew_event_rsvps(user_id);
