# STATE

## 2026-11-12 Confirmed road hazards nudge our router's search (claude/project-thread-39xbx9)
- IDEAS R-04's last piece: members' potholes, gravel and debris reports that at least one other driver confirmed (and
  that no more drivers cleared than confirmed) cost the edges within 30 m of them x1.3 in `graph_router.js`
  (`HAZARD_X`, `avoid.hazards`, at most 40 per trip, once per edge however many sit on it).
- `hazard_reports.js` `roadHazardsFor` picks them inside the trip's box; `cockpit.js` `hazardsForTrip` takes them from
  the reports `closedForTrip` has just fetched, with the drive's own, so it never waits or fails a plan. Members only.
- Every plan and loop carries them (`avoidForTrip`), with or without an Avoid switch on. Valhalla (Quick's Valhalla
  request) does not get them: a pothole is not a reason to exclude a road.
- Tests: `test_graph_router.py` hazards case, `test_hazard_reports.py`, `test_avoid_closures.py`.
- Next: R-32 Big Sur benchmark, or the next open R- item.

# CALL SHEET

## 2026-11-12 Road hazards cost x1.3, always on, confirmed only (claude/project-thread-39xbx9)

A pothole or gravel patch is a reason to prefer another good road, not to drive a dull one, so it is a small nudge
(closures are x50, police and cameras x8). Only confirmed reports count, so one driver's report can't steer everyone's routes.
No switch: nobody wants the gravel. Undo: set `HAZARD_X` to 1 in `graph_router.js`, or drop `out.hazards` in
`avoidForTrip`.
