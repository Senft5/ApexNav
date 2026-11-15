# STATE

## "School zone" by the road, only in a school run (V-13, 2026-11-15)
- `web/route_ctx/events.js`: a point `school` for each school within 150 m of the road (its grounds front it), at any
  hour, beside the existing 300 m `school_zone` channel the router costs at the plan's eta. `schoolRunAt(ms, lat, lon)`:
  a school day in that state (the same calendar) and arrival or dismissal hours (07:00-09:15, 14:00-16:15), else false;
  null where the state's school year isn't known.
- `web/road_marks.js`: kind `school`, "School zone" (strip code SCHOOL); schools within 200 m are one call.
- `cockpit.js allEvents`: a school mark reaches the notes only while it is a school run now (checked once a minute per
  mark), because a saved route can be driven hours after it was planned. In a run it is said at any pace (cruise too).
- Planned routes only for now: the road ahead on a free drive asks the map for marks only (no places).
- Voice: `mark:school` in all three packs (Whisper heard "School zone").
- Tests: `tests/test_route_ctx_events.py` (points, the hours, a Saturday, July, an unknown state), `tests/test_road_marks.py`
  (glyph), `tests/test_voice_coverage.py`; e2e "a school zone by the road…" in a school run and at noon (with the gate off
  the noon one fails).
- Next: the free drive's road ahead could ask the built points (`/api/ctx/points`) for schools too.
