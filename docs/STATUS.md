# APEX NAV — STATUS CHECKS AND WHAT TO DO WHEN IT'S DOWN (IDEAS Y-05)

`.github/workflows/status.yml` runs `tools/status_check.py` every 30 minutes (GitHub's schedule can run a few minutes
late). It is free because the repository is public. Run it by hand from the Actions tab ("Status", Run workflow) or locally
with `python tools/status_check.py`.

## What is checked

| Check | Kind | Passes when |
|---|---|---|
| Site | core | `GET /` answers 200 with a page |
| API and database | core | `GET /api/health` answers `{"ok": true, "db": true}` (the Worker ran `SELECT 1` on D1) |
| Routing (Valhalla) | dependency | the public valhalla1.openstreetmap.de routes a short Knoxville trip |
| Routing fallback (OSRM) | dependency | router.project-osrm.org routes the same trip |
| Map style (OpenFreeMap) | dependency | the Liberty style loads |
| Elevation tiles | dependency | one terrarium DEM tile loads |
| Overpass | dependency | overpass-api.de answers its status page |

Each check gets a 10 s timeout and one retry 3 s later, so a single slow answer is not an outage.

## What happens

- **A core check fails:** the run opens one issue labelled `outage`, assigned to the owner, with the table. GitHub
  e-mails the assignee. While the outage lasts, the issue gets a comment only when the set of failing checks changes (not
  every 30 minutes). The first run where both core checks pass comments "Back up" and closes the issue.
- **The check itself crashes or hangs:** the run goes red (GitHub e-mails whoever last edited the schedule) and no issue
  is opened, so a bug in the checker never reads as an outage.
- **Only a dependency fails:** nothing is opened. The table in the run summary records it. These public services are free
  and best-effort, and a pattern of failures is the case for IDEAS Y-04 (our own router).

## Keeping it running

GitHub pauses scheduled workflows in a public repository after 60 days with no commits, and says so on the Actions tab.
Re-enable it there ("Status" → Enable workflow). Any commit also resets the 60 days.

## When ApexNav is down

1. Open the failing run from the issue and check which core check failed.
2. **Site and API both failing:** check https://www.cloudflarestatus.com. If Cloudflare is fine, look at the latest
   Workers Builds deploy (Cloudflare dashboard → Workers → apexnav → Deployments). A bad deploy rolls back with
   `npx wrangler rollback` from the repo root, or with "Rollback" on an earlier deployment in the dashboard.
3. **Only the API fails, `db: false`:** D1 is refusing queries. Check the D1 metrics for `apexnav-db` and the free daily
   limits (5 million rows read, 100,000 written). If a migration or a bad write broke the data, restore it with Time
   Travel (docs/BACKUPS.md section 4).
4. Workers Logs (dashboard → Workers → apexnav → Logs) show the Worker's errors and the apps' `client_error` reports (Y-02).
