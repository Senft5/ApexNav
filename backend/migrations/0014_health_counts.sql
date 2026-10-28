-- App health counts (IDEAS Y-03): per day, per app (ios/web) and per metric, how many times something happened across all
-- phones that reported (`n`) and how many reports added to it (`reports`), so a rate can be read. No person, phone or
-- place: a phone sends yesterday's totals once, without a session. Kept 90 days (the sweep).
CREATE TABLE health_counts (
  day     TEXT NOT NULL,
  app     TEXT NOT NULL CHECK (app IN ('ios','web')),
  metric  TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, app, metric)
) WITHOUT ROWID;
