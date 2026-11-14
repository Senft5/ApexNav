# STATE

## Road marks: "Unpaved road" and "Rough road" where the map says the surface changes (2026-11-13)
- `web/road_marks.js surfaceRuns`: a GRAVEL mark ("Unpaved road") where the route turns unpaved for 50 m or more (our
  tiles' `unpaved` or Overpass `surface_paved` 0), a ROUGH mark ("Rough road") where Overpass `smoothness` is bad or
  worse for 100 m or more on a paved stretch. Runs under 300 m apart are one; none at the route's very start; untagged is
  unknown, never paved. Glyphs in `instruments.js tulipSVG`.
- `cockpit.js attachMarks` now asks again until the map (Overpass) has answered for the route (`mapAnswered`), not until
  there is any mark, since the tiles' gravel can arrive first; each answer only adds marks (`union`). A saved route with
  marks may ask the map once more (a cached answer costs no request).
- Tests: `tests/test_road_marks.py`. Next: keep roaming.

# CALL SHEET

## Unpaved and rough calls come from map tags, not measured roughness (2026-11-13)
- What: the co-driver says "Unpaved road" / "Rough road" ahead from OpenStreetMap surface and smoothness tags.
- Why: a car on summer tyres at pace hitting gravel after a bend is the classic back-road catch; the tags are sparse but
  right where present, and the call only happens where the map says so (unknown stays silent). Members' measured
  roughness stays its own thing (SURF), untouched.
- Undo: drop `out.push(...surfaceRuns(ctx, corridor))` in `road_marks.js marksOf`.

## The road-marks-during-a-drive flow no longer races the map's backoff (2026-11-13)
- It failed one run in six: the down map was an error, which backs Overpass off for a minute unless the plan's own
  deadline came first. The down map is now a hang the plan gives up on.
