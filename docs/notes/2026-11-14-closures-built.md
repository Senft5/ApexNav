# STATE
## Session 2026-11-14 (closures built): seasonal and time-of-day closures from our weekly build (claude/roam-c-closures-built)
- The route card's closures line (IDEAS R-22: OSM `*:conditional` access on the route's roads) asked public Overpass, failing on nearly every check from 11-12, so it said nothing. tools/osm_ctx/falls.py is now tools/osm_ctx/region.py and also writes `osm/v2/closures.json` (each highway way with a conditional access key: its centre, those keys, name and ref, in the same covered cells). `GET /api/ctx/closures.json` serves it; `conditional_closures.js inRegion` gives the Overpass-shaped answer for a covered box; cockpit.js `regionList` asks each list once a session.
- Next: after merge, run osm-ctx.yml on main and check the count in the run summary.

# CALL SHEET
## 2026-11-14 (closures built): closures from one region file, like the waterfalls (claude/roam-c-closures-built)
Same pattern and privacy as #821: the whole region is fetched, no route box leaves the phone. Undo: drop the `inRegion` branch in cockpit.js attachClosures.
