# STATE

## 2026-11-12 Log drive page: a shorter coaching line (free roamer B)
- Walkthrough of a drive's page in the Log on a phone: the plain-words coach line ran to five bold lines ("in 6 corners you rolled with neither brake nor gas between slowing down and speeding up; go straight from one to the other").
- Done: each habit and weak-spot fix in web/drive_view.js is a short clause ("you coasted between brake and gas in 6 corners; go from one straight to the other"); tests/test_drive_view.py holds the whole line to 140 characters. Lower down, the three-to-four-line notes under Your notes, Your touch on this drive and Against your records (web/analysis.html) are one or two lines each.
- Next: the Log's list and Your driving page on a phone.

# CALL SHEET

## 2026-11-12 Shorter drive coaching line (free roamer B)
- What: shorter HABIT and WEAK texts in web/drive_view.js plainCoach; shorter notes under three panels in web/analysis.html.
- Why: the owner's rule against walls of text; the old line was about 190 characters in bold.
- Undo: restore the old HABIT and WEAK strings and the test expectations in tests/test_drive_view.py; restore the three panel notes in web/analysis.html.
