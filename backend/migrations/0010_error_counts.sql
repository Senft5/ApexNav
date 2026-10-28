-- Crash and server error counts per day (backend/src/errors.ts, docs/BACKEND.md). Anonymous: the same scrubbed text Workers Logs
-- gets, never a user, session or IP. Readable through D1 so a report can be triaged without log access. Kept 30 days.
CREATE TABLE error_counts (
  day     TEXT NOT NULL,                                 -- 'YYYY-MM-DD' (UTC)
  source  TEXT NOT NULL CHECK (source IN ('ios','web','server')),
  kind    TEXT NOT NULL,                                 -- client: error | rejection; server: the route, e.g. 'GET /api/crews/:id/members'
  message TEXT NOT NULL,
  page    TEXT NOT NULL DEFAULT '',
  n       INTEGER NOT NULL DEFAULT 1,
  stack   TEXT NOT NULL DEFAULT '',                      -- first one seen that day
  last_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, source, kind, message, page)
);
