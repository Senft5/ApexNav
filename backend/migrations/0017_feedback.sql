-- Feedback (IDEAS L-05): what someone typed into Settings → Send feedback, with diagnostics they chose to attach (app, version,
-- platform, screen, errors today; never a place or a drive) and their handle only when they ticked "so the owner can reply".
-- Read by the owner (GET /api/ops/feedback); kept 180 days (the sweep).
CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind       TEXT NOT NULL CHECK (kind IN ('bug','idea','other')),
  message    TEXT NOT NULL,
  app        TEXT NOT NULL CHECK (app IN ('ios','web')),
  diag       TEXT,
  handle     TEXT,
  done       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX feedback_open ON feedback (done, created_at);
