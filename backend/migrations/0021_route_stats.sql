-- Server latency and error rates per day and API route (IDEAS Y-17), readable by the owner and by agents through D1.
-- Requests are sampled (1 in 10, weighted back up); server errors (5xx) are always counted exactly. Route patterns only
-- (never a concrete path, which can hold ids), so nothing identifies a person. Kept 90 days (the sweep).
CREATE TABLE route_stats (
  day     TEXT NOT NULL,
  route   TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  s4xx    INTEGER NOT NULL DEFAULT 0,
  s5xx    INTEGER NOT NULL DEFAULT 0,
  ms_sum  INTEGER NOT NULL DEFAULT 0,
  lt100   INTEGER NOT NULL DEFAULT 0,
  lt300   INTEGER NOT NULL DEFAULT 0,
  lt1000  INTEGER NOT NULL DEFAULT 0,
  ge1000  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route)
) WITHOUT ROWID;
