# STATE

## 2026-11-14 Drive it on a roadbook road leads from where you are (free roamer B)
- Done: Drive it on one road of a roadbook now routes from where you are to the road's start, then follows the road as drawn. The toast says "Road B, from Smokies day out: 9.2 mi to the start, then 0.8 mi of it." With no fix, within 300 m or beyond 150 km of the start, or with no route there, it is the road alone, as before.
- Test: the e2e "roadbooks: Drive them all" flow now also drives one road (fails on main).
- Next: none queued here.

# CALL SHEET

## 2026-11-14 The lead-in is routed, the road itself never is (free roamer B)
- What: only the leg to the start goes through the router (`routePoints`, our router first, then the Quick level); the road is kept exactly as the book drew it.
- Why: the road is someone's chosen line; the router only gets you there. If the lead-in fails, the road alone is still planned, so nothing is lost offline.
- Undo: drop the `lead` block in `driveRoad` in web/cockpit.js.
