# STATE
## Session 2026-11-12 (security pass, time attack loops): a posted loop must follow through roads (claude/project-thread-4lms1f)
- backend/src/loop_check.ts (new): samples a posted loop every 100 m and finds each sample's nearest road in Vetta's own
  graph tiles (the shipped ones through ASSETS, the rest of the region through the graph relay). It refuses with 400
  `not_on_roads` when more than 3% of samples are over 30 m from any road, or more than 25% sit nearest a residential,
  service or track road. A tile that can't be had leaves the loop unchecked. Wired into `POST /api/ta/circuit`
  (fixedMake) and `POST /api/timeattack/circuit` (makeCircuit).
- The tile reader is a cut-down port of web/graph_tiles.js decode() that reads only the classes and polylines of the
  edges near the loop. Measured on 381_516 (35,830 lines): a full decode costs 56-73 ms, while a 4.5 km loop checks in
  7-13 ms warm, about 30 ms cold.
- Tests: backend/test/loop_check.test.ts (a fixture tile written by tools/graph_etl/tiles.py write_tile). The ta_fixed and
  time_attack tests stub fetch, so their loops go unchecked.
- Next: abuse and rate-limit testing against prod-like load, then the iOS side (keychain, URL schemes, WebView bridge).

# CALL SHEET
## 2026-11-12 (security pass, time attack loops): check loops against our road tiles instead of only our own generator (claude/project-thread-4lms1f)
Curated loops still come from the first phone in an area, because the Worker can't route and CI has no D1 access to run a
generator for each area. So a hand-drawn loop through fields or a housing estate could become an area's loop for a season.
The server now checks the loop against the same tiles the phone routed on. The thresholds leave room for the router's
line and the tile's to differ by a few metres, and for a short stretch of lane. Unknown stays unknown: no tile, no refusal.
Undo: drop the two `requireOnRoads` calls (ta_fixed.ts, time_attack.ts).
