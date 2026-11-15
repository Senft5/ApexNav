# STATE

## Road page: members' camber and repaving (Q-13, 2026-11-15)
- `road_page.js` `describe` keeps `bankedKm`, `offCamberKm` and `repavedOn` from members' data (contributor.js
  `summarize`). `facts(d, fmtDist, fmtMonth)` adds "Camber · 0.3 mi banked, 0.1 mi off-camber" (50 m or more of either)
  and "Repaved · Mar 2026" (50 m or more repaved). A row is left out when nobody measured it.
- Tests: `tests/test_road_page.py` and the e2e flow "road page: About a road".
