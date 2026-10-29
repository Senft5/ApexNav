-- Livery extras (docs/design/REVIEW.md 5.1): Club pins a chat message and keeps 3 event templates; Works badges members,
-- picks a house stage, sets a convoy call sign and keeps 10 templates. Shown only while the crew's tier reaches them.
ALTER TABLE crews ADD COLUMN pinned_chat_id TEXT;
ALTER TABLE crews ADD COLUMN house_canon_id TEXT;
ALTER TABLE crews ADD COLUMN call_sign TEXT;
ALTER TABLE crew_members ADD COLUMN badge TEXT;
CREATE TABLE crew_event_templates (
  id        TEXT PRIMARY KEY,
  crew_id   TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  title     TEXT NOT NULL,
  meet_name TEXT,
  meet_lat  REAL NOT NULL,
  meet_lon  REAL NOT NULL,
  notes     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX crew_event_templates_crew ON crew_event_templates(crew_id);
