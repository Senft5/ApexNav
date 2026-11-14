# STATE

## A T-junction where the road ahead ends is called on a free drive (V-13, 2026-11-14)
- `web/horizon.js ahead` now says `tee`: the road ahead stops at a junction where it ends and every way on turns off
  (50° or more), a T, not a fork.
- `web/road_marks.js teeMark(t)`: a "T-junction" mark (code TJUNC) at the road ahead's last sample;
  `noTeeAtStop(marks)` drops it when the map has a stop sign within 40 m (the stop sign is the call there).
- `cockpit.js buildHorizon`: a tee horizon gets the mark; `apexMpsOf` brakes it to a 4 m/s turn, so it is said early
  enough to slow; a T said on one road ahead is not said again on the next (the same carry-over as the map's marks).
  `instruments.js` draws a bar across the top of the straight.
- Tests: `tests/test_horizon.py`, `tests/test_road_marks.py`; e2e "a T-junction where the road ahead ends…" (3/3).
- Next: keep roaming.

# CALL SHEET

## Only a T, never a fork, is called (2026-11-14)
- What: a junction where a way carries on within 35° (a fork, or a main road that turns into a lane) is not called.
- Why: at a fork the driver can carry on either way; at a T the road ends, which is what catches you out at speed.
- Undo: in `web/horizon.js`, set `tee` for every 'junction' end.
