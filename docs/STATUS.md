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

- **A core check fails:** the run goes red and opens one issue labelled `outage`, assigned to the owner, with the table.
  GitHub e-mails the assignee. Later failures add a comment to the same issue. The first run where both core checks pass
  closes the issue.
- **Only a dependency fails:** nothing is opened. The table in the run summary records it. These public services are free
  and best-effort, and a pattern of failures is the case for IDEAS Y-04 (our own router).

## When ApexNav is down

1. Open the failing run from the issue and check which core check failed.
2. **Site and API both failing:** check https://www.cloudflarestatus.com. If Cloudflare is fine, look at the latest
   Workers Builds deploy (Cloudflare dashboard → Workers → apexnav → Deployments). A bad deploy rolls back with
   `npx wrangler rollback` from the repo root, or with "Rollback" on an earlier deployment in the dashboard.
3. **Only the API fails, `db: false`:** D1 is refusing queries. Check the D1 metrics for `apexnav-db` and the free daily
   limits (5 million rows read, 100,000 written). If a migration or a bad write broke the data, restore it with Time
   Travel (docs/BACKUPS.md section 4).
4. Workers Logs (dashboard → Workers → apexnav → Logs) show the Worker's errors and the apps' `client_error` reports (Y-02).
