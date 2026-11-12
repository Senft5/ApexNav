# STATE
## Session 2026-11-12 (deepest analysis, PR 20): Work on names the road where its skill shows most (claude/project-thread-gd7nre)

- `web/driver_profile.js` `skillRoadLine(list, skill)`: from the roads' books, the road whose least even corners name the
  skill most often: "It shows most on Dry Ridge Rd: 2 of the 3 corners where your passes there differ most come down to it."
- `web/analysis.html`: `roadBookList()` reads every road's book once per library (shared with the Log's bookWork line);
  Your driving puts the line under the tip of its Work on (or Practicing) box.
- e2e: the four-drive road flow checks the line on Your driving.
- Next: a per-road practice could take its `where` from that road (practice only on one road's corners).

# CALL SHEET
## 2026-11-12 (deepest analysis 20): Your driving's Work on says on which road it shows most (claude/project-thread-gd7nre)

Under the Work on (or the practice under way) tip, one line names the road where that skill accounts for the most of the
corners your passes differ at. Calls: from the road books (roads driven three or more times), read once per library and
shared with the Log; none when no road's uneven corners name the skill. Undo: remove the `skillRoadLine` block in
renderDriving (web/analysis.html).
