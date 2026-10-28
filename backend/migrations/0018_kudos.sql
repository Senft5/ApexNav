-- Kudos (IDEAS S-07): one tap of thanks from a friend or crew-mate on a run they can see (a stage, a day). No text, so nothing
-- to moderate. Goes with either account (cascade). Kept 90 days (the sweep).
CREATE TABLE kudos (
  giver_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canon_id   TEXT NOT NULL,
  driven_on  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (giver_id, owner_id, canon_id, driven_on)
) WITHOUT ROWID;
CREATE INDEX kudos_owner ON kudos (owner_id, created_at);
