-- Moderation (backend/src/safety.ts, docs/BACKEND.md section 6). Additive only.
-- A report is open until the owner dismisses it or acts on it; a 'removed' row keeps the thing down (its owner can't switch it
-- back on) and dismissed reporters can't re-trigger an auto-hide. One report per person per target.
ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','removed'));
DELETE FROM reports WHERE rowid NOT IN (SELECT MIN(rowid) FROM reports GROUP BY reporter, kind, target_id);
CREATE UNIQUE INDEX reports_one ON reports(reporter, kind, target_id);
CREATE INDEX reports_target ON reports(kind, target_id, status);
-- People the owner removed: they keep their account (to export or delete it) but can never be a member again.
CREATE TABLE bans (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
