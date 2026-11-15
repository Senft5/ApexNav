# STATE

## "Roundabout" where the road ahead meets one (V-13, free driving, 2026-11-15)
- `web/horizon.js`: the map's vector tiles carry no roundabout tag, so the shape says it. At a junction, the shortest
  ring back through one of its other roads (within 320 m, six or more points, all within 50 m of their centre and the
  nearest at least 0.6 of the farthest) is a roundabout: the road ahead ends there with `end: 'roundabout'` (which exit
  is never guessed). Before, entering one at a tangent could follow the ring round as "straight on".
- `web/road_marks.js`: kind `roundabout` (RBT, a ring with an arrow), `roundaboutMark(t)` at the track's end (teeMark
  takes a kind now).
- `cockpit.js`: the horizon lays the mark when `h.end === 'roundabout'`; `apexMpsOf` brakes for it to 7 m/s (about
  15 mph, a roundabout's entry), so the call comes with room to slow. Planned routes keep their spoken directions.
- Voice: `mark:roundabout` in all three packs (Whisper heard it).
- Tests: `tests/test_horizon.py` (a ring met head-on, at a tangent, a city block that isn't one), `tests/test_road_marks.py`;
  e2e "a roundabout where the road ahead meets one" (fails with the kind removed).
- Next: check on a real free drive through a roundabout (tile simplification at low zoom may leave a small ring with
  fewer than six points, so it would read as a plain junction: silent, as before).

# CALL SHEET

## horizon.js loads with the drive, not at launch (2026-11-15)
- What: `horizon.js` moved from an `index.html` script tag to the lazy `ahead` group (`web/lazy.js`), loaded at the idle
  warm-up and at drive start, beside the other road-ahead modules.
- Why: the roundabout ring check put the launch path 1.7 KB over the startup budget (3.6 MB, e2e "startup budget"); the
  road ahead is only built while driving and `buildHorizon` already waits for `window.ApexHorizon`.
- Undo: put `<script src="horizon.js" defer></script>` back in `web/index.html` and drop it from the `ahead` group (and
  `tests/test_launch_split.py`).
