# STATE

## Corners ahead: the twisty section after a transit is called (V-16, 2026-11-14)
- `web/corners_ahead.js`: the planned route's sections (corners no more than 500 m apart, 6 or more over 1 km or more,
  after 2 km or more without a corner, so never the route's opening corners: the stage briefing has them). About 30 s
  out (400 m at least, not closer than 200 m): "Twisty section in half a mile. 3.2 miles, 18 corners."
- `cockpit.js`: a `cornersSay` slot after the briefing through the quiet gate, once per section per drive, not in
  Quiet notes, dropped after 15 s unsaid. Sections are cached on the track per events array.
- Tests: `tests/test_corners_ahead.py`; e2e "corners ahead…" (3/3).
- Next: keep roaming.

# CALL SHEET

## A section needs 2 km without a corner before it (2026-11-14)
- What: only a twisty section after a real transit is called; one after a short gap is not.
- Why: corners every few hundred metres are already called one by one; a "section" line between them is chatter.
- Undo: lower `QUIET_M` in `web/corners_ahead.js`.
