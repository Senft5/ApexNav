# STATE

## "Narrow road" where the road narrows to one lane (V-13, 2026-11-15)
- `web/route_ctx/osm_overpass.js`: a new span, `single_track`: a two-way road (not a bridge, not a driveway or a track)
  mapped with `lanes=1`. Room for one car, so an oncoming one means someone pulls over, often round a blind corner.
  The built tiles (tools/osm_ctx) already keep `lanes`, so this works from the relay too, with no rebuild.
- `web/road_marks.js narrowRuns`: "Narrow road" (strip code NARROW, two rails closing in) where it starts. Stretches less
  than 300 m apart are one (a passing place mapped as two lanes); one counts from 200 m; not when the route starts on
  it. Planned routes and the free drive's road ahead both get it (same events()).
- Voice: "Narrow road" has a clip in all three packs (`mark:narrow`, `tools/voicebank.py --voice <id> --rebuild-checked
  --only` with that key: Whisper heard each as "Narrow road", too short to pace, like "Rough road").
- Tests: `tests/test_road_marks.py` (narrow road, the strip glyph); `tests/test_voice_coverage.py` covers the new call
  through `MARK_KEY`.
- Next: keep roaming.

# CALL SHEET

## Narrow road from lanes=1 only (2026-11-15)
- What: a single track is a two-way road mapped `lanes=1`; OSM `width` is not read.
- Why: `width` is rarely tagged on US roads and the built tiles don't keep it (three KEEP lists to change and a rebuild);
  `lanes=1` on a two-way road is how OSM maps a single-track road. Unknown stays unknown: untagged roads are never narrow.
- Undo: drop the `single_track` span in osm_overpass.js and `narrowRuns` in road_marks.js.
