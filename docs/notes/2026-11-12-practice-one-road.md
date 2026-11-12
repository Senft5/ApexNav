# STATE
## Session 2026-11-12 (deepest analysis, PR 21): a practice from a road's book keeps to that road (claude/project-thread-gd7nre)
- `core/driver_profile.py` / `web/driver_profile.js`: a plan's `where` can be `{road, name}`. `practice` then reads only
  the drives with that name, before and after the plan, and says `road`; `on_plan_road` / `onPlanRoad` tell whether a
  drive counts. `practiceSummary` says "Since 12 Nov on Dry Ridge Rd: ..." (or "no drive there yet").
- `web/analysis.html`: the road book's "Practice X on my next drives here" saves the road. The end card
  (`analysis_client.js` practiceOf) says nothing about the practice on a drive elsewhere.
- Tests: tests/test_practice_focus.py (per-road practice, parity, words); the four-drive road e2e flow checks the plan and
  the Practicing line.
- Next: Your driving's "It shows most on Dry Ridge Rd" line could offer "Practice it there", the same per-road plan.

# CALL SHEET
## 2026-11-12 (deepest analysis 21): a practice started from a road's book counts that road's drives only (claude/project-thread-gd7nre)
The road book names the technique its uneven corners differ by, so practicing it elsewhere mixes in other roads. The
level before is that road's own too, so the comparison is like for like. A drive on another road gives no practice line
on its end card, rather than a misleading one. Undo: save `where: null` in showBookPractice (web/analysis.html); the
`road` handling in `practice` then never applies.
