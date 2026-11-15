# STATE

## Road page: crests and rough road members felt (Q-13, 2026-11-15)
- `road_page.js` `onThisRoad` lists crests members went light over (`crowdCrests`) and rough stretches they felt
  (`crowdRough`, with `toM`) beside the bumps. `hazardFacts` gives one line each: "Crest members went light over · at
  0.3 mi", "Rough road members felt · 0.1–0.5 mi". Both need 2+ drivers (contributor.js `crestsFrom` / `roughFrom`).
- `cockpit.js` asks `measuredAlong` with the road's metres (`dist`). Without them the rough runs were never worked out.
- Tests: `tests/test_road_page.py` and the e2e flow "road page: About a road".
