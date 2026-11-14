# STATE
## Session 2026-11-14 (graph US publish): the lower 48's bands all built; the publish can take them from that run (claude/project-thread-39xbx9)
- Done: run 43587707098 built all 141 bands (12,865 tiles, 2.77 GB, 62.6 million edges, build us-2026-46-0a3822dc-gebab6b); its publish runner was shut down two minutes into tools/graph_etl/check.py, which decoded every tile at once. graph-us.yml takes `bands_from` (a run id): plan, then publish from that run's band artifacts (kept 3 days), no osm, no band. The publish no longer runs the spot check; check.py streams tiles one at a time.
- Next: dispatch graph-us.yml on main with bands_from=43587707098 (before 2026-11-17), then check prod /api/graph/v1/index.json says us-..., and a far tile (the Dragon) answers from R2.

# CALL SHEET
## 2026-11-14 (graph US publish): no spot check in the lower-48 publish (claude/project-thread-39xbx9)
The spot roads (Colerain, Blue Rock, I-275 ...) are all Cincinnati's, and graph-region.yml checks them on the same build and model; through 62 million edges in Python the check is hours and took the runner down. Undo: put `python -m tools.graph_etl.check merged/v1 | tail -12` back in the publish's Merge and pack step (it streams now, but is still slow).
