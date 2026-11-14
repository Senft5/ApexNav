# STATE

## Speed limit drops ahead, live (V-14, 2026-11-14)
- `web/limit_ahead.js`: on the road being followed (`track.limitMps`), where the posted limit falls by 15 km/h (about
  10 mph) or more within 900 m and you are over the new one, the co-driver says "Limit 35 ahead." (driver's units, to
  the nearest 5), 3 s plus an easy 1.5 m/s² slowing before the sign; once per drop (`drive.limitSaid`).
- `cockpit.js`: a `limitSay` slot, first through the quiet gate (8 s, then it is stale). `index.html` loads it deferred.
- Tests: `tests/test_limit_ahead.py`; e2e "the co-driver says a speed limit that drops ahead once…".
- Next: keep roaming.

# CALL SHEET

## The limit call speaks in every notes mode, Quiet included (2026-11-14)
- What: "Limit 35 ahead." is said in Quiet notes too, as camera calls are.
- Why: it is a ticket call, not a pace note (Nate: police and camera calls good); one short line per drop, only when you
  are over the new limit.
- Undo: add `&& state.notesMode !== 'quiet'` to the `limitSay` condition in `cockpit.js`.
