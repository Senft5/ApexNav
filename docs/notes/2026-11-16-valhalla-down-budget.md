# CALL SHEET
## 2026-11-16 (valhalla down budget): the warm final-card budget in the Valhalla-down e2e flow is 900 ms, not 700
The flow "valhalla down: planning inside our tiles is unaffected" failed on #995 and #999, both social-only PRs, at 707 and 741 ms for the "abort warm" final card. Locally it takes 466 to 533 ms over 5 runs on main, and 470 to 525 ms on the commit before #954, so nothing in the router got slower: a busy CI runner is about 1.4 times slower. The first route's 400 ms budget, the part a driver sees first, is unchanged, and so is the cold card's 1000 ms. Undo: set cardMs back to 700 for warm runs in e2e/smoke.js.

# STATE
## Session 2026-11-16 (valhalla down budget): flaky e2e budget (claude/project-thread-39xbx9)
- Done: the timings above were measured, and only the warm card budget was raised.
- Next: the fun-routing work goes on (docs/notes/2026-11-15-scenic-byways.md: the full US build with byways went live on 2026-11-16, and 19 of 24 famous roads pass).
