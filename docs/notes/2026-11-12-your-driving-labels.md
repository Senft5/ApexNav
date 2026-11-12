# STATE
## Session 2026-11-12 (deepest analysis, PR 25): Your driving's numbers say what they are (claude/project-thread-gd7nre)
- The scope line names the period read: "108 clean corners · 3 drives · Aug–Oct 2026" (`profile` gains `span`, Python
  and JS; `scopeLine`).
- A skill's definition shows when you tap its row (`skillDef`): what it measures, 0 to 100, how many corners it is
  averaged over, and the minimum. This replaces a hover tooltip, which a phone cannot show. The row is a keyboard
  button with aria-expanded.
- The practice summary gives both samples and the change in points: "100 on 36 corners ... against 52 on 108 before.
  Up 48 points".
- Tests: tests/test_practice_focus.py (span, scope line, definition, words); Your driving and Practice e2e flows.
- Next: road book rows give their passes count where the record is read from few passes; trim lines that only repeat
  a number.

# CALL SHEET
## 2026-11-12 (deepest analysis 25): definitions on a tap, not in footnotes (claude/project-thread-gd7nre)
Nate's rule bans explanatory paragraphs, and the UI/UX guide he shared asks for every number to be defined. A tap on the
row satisfies both. Undo: put `mid.title = WORDS[k].is` back in place of defOnTap in render (web/driver_profile.js).
