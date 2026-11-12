# STATE

## 2026-11-12 Our router keeps off reported closures, and loops keep off police and cameras (claude/project-thread-39xbx9)
- `graph_router.js` objective: members' "Road closed" reports near the trip (`avoid.closed`, from `hazard_reports.js`
  `closuresFor`) make the edges within 40 m cost x50 (`CLOSED_X`, `CLOSED_M`), always on. Until now only Valhalla (Quick)
  got them, so Fun, Long way and loops drove straight through a reported closure.
- `cockpit.js` `avoidForTrip` adds `closed` for every plan (signed in only, from the 5 min hazard cache, or a wait of
  `POLICE_WAIT_MS` at most). Opening Where to? warms the hazards round you for every member, not only with Avoid police.
- Loops (`buildLoop`) now search with `avoidForTrip` on a box round the start (a third of the length each way, 3 to 35 km):
  police reports, cameras and closures. Before, a loop got the bare switches and no lists, so Avoid police and Avoid
  cameras did nothing for loops, and the card never said a loop passed one.
- Next: the route card doesn't say when a plan still drives a reported closure (no way round). Add a "closed" word to
  the card without making it an Avoid switch (`FunRoute.AVOID_LABELS` keys are the Plan sheet's switches).

# CALL SHEET

## 2026-11-12 Reported closures cost x50 in our router, with no switch (claude/project-thread-39xbx9)

A closure is a member's report, and it can be stale, so it isn't a ban: with no way round, the route still goes (as
Valhalla's is asked again without its exclusions). x50 makes any sensible detour win. No Plan sheet switch: nobody wants
a closed road. Loops use the same lists as a trip, on a box a third of their length each way (capped at 35 km so the
camera map's 1 degree box holds). Undo: `CLOSED_X` to 1 in graph_router.js, and `L.avoid` back to `avoid` in
cockpit.js `buildLoop`.
