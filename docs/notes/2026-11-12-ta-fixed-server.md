# STATE
## Session 2026-11-12 (fixed time attacks, part one): the server (claude/project-thread-uwmi4e)
- Done: migration 0057 (ta_circuits, ta_entered, ta_times) and backend/src/ta_fixed.ts: up to three loops per area a season (calendar quarter), built by phones from seeds, 3 km apart; one featured a week in turn; boards by week, month, year, all time; report takes one down and its slot is rebuilt; For you "passed" and the data export cover it. Tests: backend/test/ta_fixed.test.ts.
- Next: the app (web/time_attack.js): the three loops with the featured one first, Week / Month / Year / All time chips, makeLoop builds a slot with `best` (the router's top loop) away from `avoid`; sync runs to /api/ta/runs. Then drop the weekly endpoints once no build calls them.

# CALL SHEET
## 2026-11-12 (fixed time attacks): a season is a calendar quarter, three loops, featured weekly (claude/project-thread-uwmi4e)
Nate: "static best roads maybe changing every few months ... rotating highlighted time attacks, with a leaderboard that you can view by week; month; year; all time." A quarter is "every few months" and lines up for everyone. Three loops so there is something to rotate; the featured one changes each Monday. Times are kept per day so every period is exact; all time is the loop's own season, and nothing carries over from the weekly loops. The weekly tables and endpoints stay so builds already on phones keep working. Undo: revert the PR; the new tables can be dropped (migration header).
