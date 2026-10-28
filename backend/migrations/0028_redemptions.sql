-- Octane redemptions (IDEAS S-10): cosmetic items bought with earned Octane (never with money; Octane can't be bought).
-- Nothing here is safety-related or changes a score. One row per item a member owns; balance = earned - spent.
CREATE TABLE redemptions (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  octane     REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item)
) WITHOUT ROWID;
