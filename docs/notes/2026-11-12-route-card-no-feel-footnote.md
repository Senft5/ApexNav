# STATE

## 2026-11-12 route card: no "Road feel after first drive"
- Done: the route card's small line under the stats no longer ends "Road feel after first drive" when nothing on the route is measured yet; the dials' dashes already say it. With coverage it still says "Road feel N% driven". The line hides when it has nothing to say, and a trailing " · " is trimmed.
- Tests: every e2e flow matching "route" passes (47/47).
- Next: keep sweeping the shell, Where to? and the Log for footnotes that explain an empty state.

# CALL SHEET

## 2026-11-12 route card empty-state footnote dropped
- What: `feel` is '' with no measured coverage; #routeCardSub hides when empty.
- Why: Nate's rule to hide empty states instead of explaining them; the Surface dial already shows "--".
- Undo: restore 'Road feel after first drive' in web/cockpit.js and drop the hidden line.
