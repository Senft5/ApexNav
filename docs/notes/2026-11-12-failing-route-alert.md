# STATE
## Session 2026-11-12 (monitoring): a route that keeps failing opens the outage issue (claude/project-thread-g9yher)
- Done: the status workflow only knew "site up", "database answers" and the two cron jobs, so a deploy that broke one route (every drive upload a 500, say) never told anyone. `/api/health` now has `failing_routes` (`failingRoutes`, backend/src/errors.ts): routes with 25 or more unexpected 500s today whose latest is under 30 minutes old, by route pattern only (the endpoint is public, so no message). tools/status_check.py has a core check "API errors"; the issue is titled "ApexNav: a route keeps failing" and closes itself once the errors stop. docs/STATUS.md says what to do.
- Not counted: the page's own error reports, the cron jobs (their own checks), the service check's rows, yesterday's errors, a burst that stopped.

# CALL SHEET
## 2026-11-12: 25 a day, the latest within 30 minutes
- What: `REPEAT_N = 25`, `REPEAT_MIN = 30` in backend/src/errors.ts.
- Why: one person's retries on a broken route reach 25 within minutes, so it fires while it matters; a handful of one-off 500s or yesterday's burst never page.
- Undo: drop the "API errors" row in tools/status_check.py `checks()` (the health field can stay).
