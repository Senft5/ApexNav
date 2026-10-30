-- A crew drive's record (docs/design/REVIEW_PEOPLE.md P-03, roadmap 2): who came. A member is marked as having come when
-- they start or join the drive's convoy from its card, or say "I was there" on the card afterwards. Only the fact, never a
-- position; it goes with the drive (the daily sweep, 7 days after it starts) or with the account.
CREATE TABLE crew_event_attendance (
  event_id   TEXT NOT NULL REFERENCES crew_events(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
) WITHOUT ROWID;
CREATE INDEX crew_event_attendance_user ON crew_event_attendance(user_id);
