# STATE

## 2026-11-13 Fun and Long way plans get longer before the page gives up (claude/project-thread-39xbx9)
- `graph_router.js` `client`: a plan's timeout is now by level: Quick keeps the page's own (6 s, `OWN_PLAN_MS`), Fun
  gets 12 s and Long way 20 s, as loops have had 20 s since 2026-11-12.
- Why: Long way searches a wider corridor with more weights; on the bundled Cincinnati tiles a 25 km Long way plan
  takes 1.5x a Fun plan's time (node: 1.3 s against 0.85 s), and the service check saw Fun take 5.5 s on Nate's web run,
  next to the 6 s limit. A timed-out Long way has no fallback (Valhalla is Quick's only), so it was a hard failure.
  (The two "router_long: down" rows themselves were probably a hidden page, per the service check thread.)
- Tests: `test_graph_router.py` client case (Quick still times out at the page's limit; Fun and Long way wait).
- Next: make the Long way search itself cheaper (profile: A* search ~70%; ~12 to 15 searches per plan).

# CALL SHEET

## 2026-11-13 Plan timeouts by level: Fun 12 s, Long way 20 s (claude/project-thread-39xbx9)

A slow answer beats an error when there is no other router to ask. Quick stays at 6 s because Valhalla answers it too.
The card shows its progress meanwhile. Undo: `PLAN_MS` in `graph_router.js` `client`.
