# STATE

## Along the way, live: last fuel and viewpoints said as they come up (R-24, R-23, 2026-11-14)
- `web/along_ahead.js due(t, cursorM, vMps, o)`: from the route card's places (`t.scenic`, scenic.js along):
  - the last fuel before 80 km or more with none, about 45 s out, on its side: "Last fuel for 56 miles, in half a
    mile, on the right." / "Last fuel of the route, …"; an electric car hears its chargers. Any notes mode.
  - a viewpoint or waterfall by name (32 characters or fewer, else "A viewpoint"), about 20 s out, at most one every
    5 minutes, not in Quiet notes: "Craggy Pinnacle on the left, in a quarter mile."
- `cockpit.js`: an `alongSay` slot after corners ahead in the quiet gate, planned route only, each place once a drive.
- Tests: `tests/test_along_ahead.py`; e2e "along the way…" (3/3).
- Next: keep roaming.

# CALL SHEET

## The last-fuel line is said in Quiet notes too (2026-11-14)
- What: the fuel line ignores the notes mode; viewpoints follow it.
- Why: running dry on a mountain road is a safety matter, like the break cue; a viewpoint is a nicety.
- Undo: in `cockpit.js`, skip the call when `state.notesMode === 'quiet'`.

## Viewpoints at most one every 5 minutes (2026-11-14)
- What: after one viewpoint or waterfall is said, the next ones are not for 5 minutes.
- Why: a parkway maps an overlook every mile; a call for each is chatter.
- Undo: `VIEW_EVERY_S` in `web/along_ahead.js`.
