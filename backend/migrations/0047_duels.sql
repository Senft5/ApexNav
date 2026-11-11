-- Duels (docs/SOCIAL.md 2.7): one friend challenges another on a stage for a few days; the higher Vetta Score on it wins.
-- Scores only (technique, never a time or a speed), and only runs each driver already chose to show the other (grants and
-- board_entries, 0001). Nothing new about a drive is stored here. Additive only. Undo: DROP TABLE duels.
CREATE TABLE duels (
  id           TEXT PRIMARY KEY,
  challenger   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canon_id     TEXT NOT NULL,                                    -- the stage, as boards key it (COALESCE(origin_id, id))
  stage        TEXT NOT NULL,                                    -- its name when the duel was made
  days         INTEGER NOT NULL CHECK (days BETWEEN 1 AND 14),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','on','declined','withdrawn')),
  starts_on    TEXT,                                             -- the first day that counts (set when accepted)
  ends_on      TEXT,                                             -- the last day that counts
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX duels_challenger ON duels(challenger, status);
CREATE INDEX duels_opponent ON duels(opponent, status);
