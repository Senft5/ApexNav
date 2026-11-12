# STATE
## Session 2026-11-12 (deepest analysis, PR 25): Your driving's numbers say what they are (claude/project-thread-gd7nre)
- The scope line names the period read: "108 clean corners · 3 drives · Aug–Oct 2026" (`profile` gains `span`, Python
  and JS; `scopeLine`).
- A skill's definition shows when you tap its row (`skillDef`): what it measures, 0 to 100, how many corners it is
  averaged over, and the minimum. This replaces a hover tooltip, which a phone cannot show. The row is a keyboard
  button with aria-expanded.
- The practice summary gives both samples and the change in points: "100 on 36 corners ... against 52 on 108 before.
  Up 48 points".
- Shorter findings: "Shows most on Dry Ridge Rd: 2 of its 3 least even corners." (skillRoadLine), hidden while the
  practice already keeps to a road; a practice with no drive yet says "Since 12 Nov on Dry Ridge Rd: no drive there yet
  with 4 or more corners."
- Tests: tests/test_practice_focus.py, tests/test_best_corners.py (span, scope line, definition, words); Your driving and Practice e2e flows.
- Next: the road book's head and its practice line are still two sentences each; make them one line each.

# CALL SHEET
## 2026-11-12 (deepest analysis 25): definitions on a tap, not in footnotes (claude/project-thread-gd7nre)
Nate's rule bans explanatory paragraphs, and the UI/UX guide he shared asks for every number to be defined. A tap on the
row satisfies both. Undo: put `mid.title = WORDS[k].is` back in place of defOnTap in render (web/driver_profile.js).
