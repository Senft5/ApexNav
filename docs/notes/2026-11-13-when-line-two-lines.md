# STATE

## 2026-11-13 The route card's tap rows keep two lines inside the row (claude/project-thread-5sbga7)
- Done: on a 375 px phone the When to go row ("Better at 2:00 PM tomorrow: no school run") wraps to two lines, and its words ran over the rule above the row (and its clock icon sat off the first line). The tap rows (.when-line: When to go, Along) now pad their own 44 pt target, so one line is placed exactly as before and a second line grows the row instead of spilling out of it.
- Tests: e2e "when to go" checks a two-line When line sits inside its row (it fails on the old CSS); "Dynamic Type", "along the route by name", "waterfalls", "design pass 2", "a reported road closure".
- Next: keep sweeping the route card at small sizes.

# CALL SHEET

## 2026-11-13 .when-line pads its 44 pt target
- What: index.html .when-line: padding 12px 0 (was 0), with the same -12px margins and 44px min-height (border-box).
- Why: the min-height alone made the target, so text taller than 20 px pushed the box past the row's padding.
- Undo: padding back to 0.
