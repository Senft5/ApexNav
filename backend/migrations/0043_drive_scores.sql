-- The crew Score board as a total (the owner's TestFlight note 06, 2026-10-31): each drive's Vetta Score, published by the
-- driver's app to every crew they share Scores with (grants.share_scores), one row per drive per crew, so a grant reaches
-- only what was published while it was on. Only the number and the day: never where, never how fast. Goes with the grant
-- (switched off), with leaving the crew, with the crew, or with the account.
CREATE TABLE drive_scores (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_id    TEXT NOT NULL,                       -- the app's own id for the drive, opaque here
  crew_id     TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 1000),
  driven_on   TEXT NOT NULL,                       -- YYYY-MM-DD, the phone's day
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, drive_id, crew_id)
) WITHOUT ROWID;
CREATE INDEX drive_scores_crew ON drive_scores(crew_id, driven_on);
