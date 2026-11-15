# STATE

## 2026-11-15 Time attacks and meets pop up on the map as you drive near
- Done: Nate asked for time attacks and meets to pop up like an open-world game's events. `web/event_markers.js` (lazy, social bundle) draws the area's time attack loops as glowing start gates and your crews' drives and public meets in the next 24 h at their meeting points, and raises one bold card as you drive up to one (name, three facts, Start or Join, Not now). Layers → Events, on by default. Start uses `timeAttack.go(c)` (new in web/time_attack.js: enter, then drive the loop). No backend change, no migration. Tests: tests/test_event_markers.py, e2e "events on the map".
- Next: CarPlay could show the same card as a CPAlertTemplate-style banner; a "Your best" on meets (who's going from your friends).

# CALL SHEET

## 2026-11-15 When an event card rises
- What: a gate within 450 m, a meet within 800 m (3 h before to 1 h after its start), only ahead of you (75 degrees) while moving faster than 4 m/s, one card at a time, Not now keeps it down 30 min. The card sits above the tab bar, over the home deck. Why: glanceable and never a stack of popups while driving. Undo: the constants at the top of web/event_markers.js, or turn the Events layer default off in cockpit.js `state.toggles`.
