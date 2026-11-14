# STATE
## Session 2026-11-14 (small keys): no key in view is too small to hit (claude/project-thread-dpdmcn)
- Done: every e2e flow's last screen is checked for a key too small to hit (`smallTargets` in e2e/smoke.js, next to `clippedText`): a button, link, switch, tab or field that is in view, on top, and under 24 x 24 px (WCAG 2.5.8). Links inside a sentence, the map's markers and a flow's own #e2e test fields are left out. `TAP_LOG=1` lists the hits instead of failing.
- Fixed, found by the sweep: the theme trial's Stop and Watch a replay keys were 15 px tall, and the route card's story line (the summary that opens the story) was 22 px. Each now has a bigger tap area, and the layout is unchanged.
- Open: the map's place pins (café, fuel, viewpoint, falls) are 16 px tall. They clip their own label (overflow: hidden), so a pseudo-element can't make them bigger. They're left out of the check; the Along list names the same places with full-size rows.
- Tests: full e2e locally (two shards at a time; three timing flows failed under that load and pass alone). pytest.
- Next: another roam item.
