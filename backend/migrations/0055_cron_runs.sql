-- The Worker's cron jobs (src/cron_runs.ts): when each last finished and when it last failed. GET /api/health reads it, so
-- the status workflow (tools/status_check.py) opens an outage issue when the weekly backup or the daily sweep stops.
-- One row per job; no person in it.
CREATE TABLE cron_runs (
  job TEXT PRIMARY KEY,            -- 'backup' | 'sweep'
  ok_at TEXT,                      -- last run that finished (ISO 8601 UTC with milliseconds)
  fail_at TEXT,                    -- last run that threw
  reason TEXT                      -- the last failure, scrubbed (src/errors.ts scrub)
) WITHOUT ROWID;
