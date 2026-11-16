-- Crew admins (2026-11-16, Nate: crews as Facebook Groups, "Yes, build admins"): the owner makes members admins, who help
-- run the crew: they can invite even when the owner set "Who can invite: Owner", remove members (never the owner or another
-- admin), delete chat messages, and change or cancel crew drives. Renaming, settings and admins stay the owner's.
-- An admin who leaves or is removed stops being one; gone with the crew or the account.
CREATE TABLE crew_admins (
  crew_id    TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (crew_id, user_id)
);
CREATE INDEX crew_admins_user ON crew_admins(user_id);
