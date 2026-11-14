# STATE

## Stage briefing as a planned drive starts (V-15, 2026-11-14)
- `web/briefing.js line(t, cursorM, spoken)`: "12 miles, 42 corners, 2 hairpins. Stop sign in 4.2 miles, unpaved road in
  9 miles." The route's corners ahead, its hairpins, and the first two marks (road_marks.js) that change how you drive:
  stop, rail crossing, one-lane bridge, unpaved, rough. Nothing under 3 km or under 5 corners.
- `cockpit.js`: a `briefSay` slot after the limit call through the quiet gate, once per drive (`drive.briefed`), only
  on the planned route, not in Quiet notes; dropped after 30 s without a quiet moment.
- Tests: `tests/test_briefing.py`; e2e "the stage briefing…". The 49 e2e flows that listen to speech all pass.
- Next: keep roaming.

# CALL SHEET

## The briefing is said once at the start, not again after a reroute (2026-11-14)
- What: one briefing per drive; a reroute mid-drive gets none.
- Why: a reroute is often a small change of the same road; a second read of a stage mid-drive is chatter.
- Undo: reset `drive.briefed = false` where a route is built in live mode (`buildRoute`).
