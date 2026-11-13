# STATE

## Road marks: a mapped speed bump the route already calls is one call (2026-11-13)
- `web/road_marks.js` `unfelt(marks, events)`: a HUMP mark is left out when the track already has a `bump` event (a member's
  or the crowd's) within 30 m of its run; `events()` applies it and marks carry `end_m` (the run's last hump).
- `cockpit.js applyCrowdBumps` prunes `t.marks` the same way when crowd bumps arrive after the marks.
- Tests: `tests/test_road_marks.py` (felt inside the run, felt 100 m past it, stops untouched, a saved mark with no end).
- Next: keep roaming (fun-driving calls, bug hunts).

# CALL SHEET

## The felt bump wins over the mapped hump (2026-11-13)
- What: when both exist at one spot only "Bump" is said, not also "Speed bump".
- Why: one thing, one call; the felt bump is measured, the map's tag is not, and two calls for one hump trains drivers to ignore both.
- Undo: return `out` instead of `unfelt(out, t.events)` in `road_marks.js events()` and drop the line in `applyCrowdBumps`.
