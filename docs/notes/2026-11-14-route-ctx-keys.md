# STATE
## Session 2026-11-14 (route context keys): the keyed sources work for every driver (claude/project-thread-39xbx9)
- Done: cockpit.js calls ApexRouteCtxUtil.loadKeys() at start-up (the Worker's CTX_KEYS, kept a day; one typed on the phone wins), and routeCtxSettings() reads `apex.keys`, which nothing had: it read `apex.routeKeys`, which nothing ever wrote, so events and hazards-live were gated "no-key" on every phone. Live, on the branch preview (tools/route_engine_live.js KEYS=0 / KEYS=1, six calibration trips): the same picks either way, plans 0.4-1 s longer (inside CTX_BUDGET_MS), OHGO's Ohio work zones now answer (5 of 8 calls 200, the rest cut at the budget).
- Bugs: SeatGeek refuses the client id in CTX_KEYS (403 "Invalid client credentials"): owner fix in docs/OWNER_TODO.md. Mapillary signs feed only the Valhalla candidates' context (own routes run the time-dependent providers only), so they change nothing here.
- Next: a Worker relay for NASS crop progress (/api/ctx/nass) if real harvest weeks matter more than the typical windows.

# CALL SHEET
## 2026-11-14 (route context keys): NASS's key is no longer handed to phones (claude/project-thread-39xbx9)
USDA QuickStats answers without a CORS header, so the app's 15 calls a plan all failed; harvest traffic keeps the USDA typical windows (Handbook 628), as every phone already had. Removed from CTX_KEY_NAMES in backend/src/route_feeds.ts. Undo: add "nassApiKey" back once a Worker relay asks NASS on the phone's behalf.

## 2026-11-14 (graph ETL tests): the posted-limit test picks its edge by the class estimate, and CI runs the module (claude/project-thread-39xbx9)
test_travel_time_takes_the_road_inventorys_posted_limit... looked in the shipped Cincinnati tile for an edge the tile
estimates (no OSM sign) that the road inventory covers: there is none (every long secondary edge HPMS covers has an OSM
sign; the four estimated ones have no inventory), so nothing is dropped, the test's pick was stale. It now takes a long
secondary edge HPMS covers whose limit differs from the class estimate, scored as unsigned, as the test always did. CI's
pytest job installs tools/graph_etl/requirements.txt, so test_graph_etl.py runs there instead of skipping whole. Undo:
the requirements line in core-tests.yml.
