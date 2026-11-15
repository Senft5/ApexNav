# STATE

## "Limit 35 ahead." on a free drive with no route (V-14, 2026-11-15)
- `web/limit_ahead.js fromCtx(ctx, corridor, dist)`: the map's posted limits (Overpass `maxspeed_kph`) per sample of a
  track, null where the map has none (unknown stays unknown); `saidNear(said, lat, lon)`.
- `cockpit.js attachHorizonMarks`: the road ahead takes its limits from the same answer that gives its marks, so the
  limit plate and the drop call work on a free drive (`t.limitSource = 'map'`).
- A drop is now said once per place (within 60 m), not per track and distance: the road ahead is rebuilt and overlaps
  itself, and its id is always 'horizon'. `apexDebug.limitSaid` counts them for e2e.
- Tests: `tests/test_limit_ahead.py`; e2e "a limit that drops on the road ahead…" (3/3, and it fails with the
  per-place check off).
- Seen while testing: in headless e2e a second line that goes to the model voice keeps `speech.busy` (no audio ends
  it), so a flow that needs two quiet-slot lines in a row should not wait for the second one to be said.
- Next: keep roaming.
