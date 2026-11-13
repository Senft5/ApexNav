# STATE

## 2026-11-13 The end card with no score says why, once (claude/project-thread-5sbga7)
- Done: a drive with no score read "3.7 mi · no corners to score" right over a facts row that starts "3.7 mi" and ends "0 corners". The score's slot now says only why: "No corners to score" or "Too few clean corners to score"; the distance stays in the facts row under it.
- Tests: pytest; e2e "first run and the end card", "the app comes back whole", "End: the card is up within 150 ms".
- Next: keep sweeping the shell.

# CALL SHEET

## 2026-11-13 no distance in the no-score headline
- What: cockpit.js endCardScored: the no-score text is noScoreWords(c.corners) alone, capitalised as a headline.
- Why: the same number twice in one card (Nate's "cluttered" note, 2026-11-12); the facts row already has the distance.
- Undo: put back `[ApexFormat.distance(c.len_m), noScoreWords(...)].join(' · ')` and the lower-case words.
