# STATE
## Session 2026-11-14 (graph US publish): the lower 48's bands all built; the publish can take them from that run (claude/project-thread-39xbx9)
- Done: run 43587707098 built all 141 bands (12,865 tiles, 2.77 GB, 62.6 million edges, build us-2026-46-0a3822dc-gebab6b); its publish runner was shut down two minutes into tools/graph_etl/check.py, which decoded every tile at once. graph-us.yml takes `bands_from` (a run id): plan, then publish from that run's band artifacts (kept 3 days), no osm, no band. The publish no longer runs the spot check; check.py streams tiles one at a time.
- Next: dispatch graph-us.yml on main with bands_from=43587707098 (before 2026-11-17), then check prod /api/graph/v1/index.json says us-..., and a far tile (the Dragon) answers from R2.

# CALL SHEET
## 2026-11-14 (graph US publish): no spot check in the lower-48 publish (claude/project-thread-39xbx9)
The spot roads (Colerain, Blue Rock, I-275 ...) are all Cincinnati's, and graph-region.yml checks them on the same build and model; through 62 million edges in Python the check is hours and took the runner down. Undo: put `python -m tools.graph_etl.check merged/v1 | tail -12` back in the publish's Merge and pack step (it streams now, but is still slow).

## 2026-11-14 (graph US publish): a bands_from plan skips Geofabrik; a whole plan tries its index for 25 min (claude/project-thread-39xbx9)
The first bands_from run failed in plan: Geofabrik refused that runner's index request six times in a minute, though the reuse needs no index. Now the plan outputs placeholders and stops before Geofabrik when bands_from is set, and a whole build's plan retries the index for up to 25 min (the refusals have lasted that long). Undo: drop the `if [ -n "$IN_BANDS" ]` block and put the curl back to --retry 5 --retry-delay 10.

## 2026-11-14 (graph US publish): another run's bands are fetched by id, and all of them or none (claude/project-thread-39xbx9)
actions/download-artifact with run-id lists only the first 100 of that run's artifacts: the bands_from publish put 100 of 141 bands live (10,522 of 12,865 tiles; Texas, Florida, the Northeast and the Pacific Northwest left out, nothing lost against the old OH/KY/IN map). The publish now lists the run's artifacts paginated, downloads each by id, and fails unless there is one per band job. Undo: put download-artifact back with run-id (only safe under 100 bands).

## 2026-11-14 (graph US publish): Washington and Oregon are states of the lower 48 (claude/project-thread-39xbx9)
All 141 bands went live (12,865 tiles), but Seattle, Portland and the Oregon coast were off the map: us_plan.states kept a state only when its Geofabrik polygon lay within 1 degree of the lower 48's box, and Washington's runs out to sea to -126.7, Oregon's past -126. The slack is now 3 degrees (LOWER48_SLACK; Alaska and Hawaii are still far outside); blocks stay on the -125 grid. A whole rebuild follows. Undo: LOWER48_SLACK = 1.0.

## 2026-11-14 (graph US publish): the lower 48 rebuilds on the 1st of each month (claude/project-thread-39xbx9)
graph-us.yml runs on a schedule (cron 23 3 1 * *): the whole country, live when every band builds. Monthly, not weekly: about 13 h of public-repo runners and all 49 Geofabrik extracts a build, for roads that change slowly. The region build (graph-region.yml) stays manual; its mirror never shrinks a live lower 48 (upload_r2.sh). Undo: drop the schedule block.
