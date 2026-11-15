# STATE
## Session 2026-11-15 (long trips): Fun and Long way plan trips of 400+ km on the phone (claude/project-thread-39xbx9)
- Done: web/graph_router.js. A corridor of more than K.LONG_TILES (120) tiles, which is about 150 km crow at Fun and 100 km at Long way, is no longer the whole ellipse. It is a band of K.BAND_M (Fun 20 km, Long way 30 km) round a spine. The spine is the quickest way on a band of 15 % of the crow line (20 to 40 km) round the straight line, kept for the trip's next ask. Used by plan, the first route's fallback and there-and-back (host corridorOf). Trips over K.LONG_KM (150 km) bisect more coarsely (LONG_TOL) and try one LOWER weight. The client's plan, quick and round timeouts get 60 ms per crow km past 150 km.
- Measured on live tiles (this machine, first load included):
  - Cincinnati to Asheville. Fun went from 580 tiles (258 MB) and 39 s to 65 tiles and 5 s of search, about the same goodness (0.439 against 0.465). Long way went from no route at all (1,271 tiles) to 84 tiles and 7 s.
  - Cincinnati to Chicago, Fun 9 s / Long way 12 s; LA to SF, 11 s / 14 s; Denver to Moab, 5 s / 6 s.
  - A phone is maybe 2 to 3 times slower, so 400+ km plans still take 20 to 40 s.
- Done (second PR): past K.PLAN_SOFT_MS (6 s) a plan stops refining. After at least two bisection steps it skips further steps, the cheaper weights, the alternates and the spread, and answers. With the soft limit at 3 s, Cincinnati to Chicago and LA to SF gave the same picks within 0.01 goodness in half the time, so a slow phone gets a route, not a timeout.
- Next (was): search time on 400+ km trips (about 1 s for each of about 10 searches). A coarser first pass, or a time budget that stops the bisection, would bring it down.

# CALL SHEET
## 2026-11-15 (long trips): a long trip's Fun searches near its quickest way, not the whole ellipse (claude/project-thread-39xbx9)
The ellipse for a 450 km trip spans about 700 km by 400 km of tiles, more than a phone can load or search, so those plans timed out with no route. Good road more than 20 km (Fun) or 30 km (Long way) off the quickest way is now out of reach on trips over about 150 km. That is the trade for a route at all. Undo: raise K.LONG_TILES past any corridor (e.g. 1e9) in web/graph_router.js.

## 2026-11-15 (long trips): a plan past 6 s answers with what it has (claude/project-thread-39xbx9)
A plan that ran past the page's timeout gave the driver nothing at all. Stopping refinement at 6 s gives the route found so far, which in the measurements was within 0.01 goodness of the full plan. Undo: K.PLAN_SOFT_MS = Infinity in web/graph_router.js.
