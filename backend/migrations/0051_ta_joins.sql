-- Time attack entry is the opt-in (docs/APP_REVIEW.md 1.4). Until now any copy of a circuit's stage counted, so a friend
-- who shared a stage by hand, or a duel's copy, put that driver's times on a board every member sees without their saying
-- so, and "Take my time off" lasted only until the next sync sent the run again. A row here is "entered this week";
-- runs count only with one, and taking your time off takes it away. Additive only. Undo: DROP TABLE ta_joins.
CREATE TABLE ta_joins (
  week        TEXT NOT NULL,                                   -- the Monday it starts, 'YYYY-MM-DD' (UTC)
  cell        TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (week, cell, user_id)
) WITHOUT ROWID;
CREATE INDEX ta_joins_user ON ta_joins(user_id);
