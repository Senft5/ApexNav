# STATE

## "Bridge may be icy" in the cold (V-13, 2026-11-15)
- `web/route_ctx/osm_overpass.js`: span `road_bridge` for any bridge the route is on, except motorways and trunk roads
  (label its name). Planned routes and the free drive's road ahead both get it (both ask Overpass).
- `web/road_marks.js`: kind `icy_bridge`, "Bridge may be icy" (plural for bridges less than 500 m apart; strip code ICE,
  a snowflake over an arch). A one-lane or covered bridge keeps its own call. `bridgeCold(tempC)`: 3 °C or colder;
  unknown is false. `cruiseWorthy`: said at any pace in the cold.
- `cockpit.js allEvents`: an icy-bridge mark reaches the notes, strip and map only while the place plate's air temperature
  where you are (`placeAsk.data.tempC`, Open-Meteo, asked every 20 min or 5 km) is 3 °C or colder, or the road is icy
  already (`drive.wet.state`).
- Voice: `mark:icy_bridge`, `mark:icy_bridges` in all three packs (Whisper heard each).
- Tests: `tests/test_road_marks.py` (spans, merging, one-lane bridge, motorway, the threshold, glyph); e2e "a bridge on the
  road ahead is "Bridge may be icy" only in the cold" at 1 °C (said) and 10 °C (not said).
- Next: real-drive check of how often it speaks on a cold morning on Nate's roads (creek culverts mapped as bridges may
  make it chatty; the 500 m merge is the knob).

# CALL SHEET

## Icy-bridge threshold 3 °C, not on motorways, said at any pace (2026-11-15)
- What: "Bridge may be icy" is said at an air temperature of 3 °C (37 °F) or colder, on bridges off motorways and trunk
  roads, in cruise too.
- Why: a bridge deck loses heat from above and below and can sit a few degrees under the air on a clear night, so it
  freezes while the road is still above freezing (the "Bridge ices before road" sign). Interstates cross a bridge every
  mile or so and are treated first: calling each would bury the call. Ice on a straight road is no less ice, so it does
  not wait for the notes to wake.
- Undo: `ICY_BRIDGE_C` in `web/road_marks.js` (threshold), the highway test in `osm_overpass.js` `road_bridge`, and the
  `icy_bridge` line in `cruiseWorthy`.
