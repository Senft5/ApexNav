# STATE

## 2026-11-12 Log drive page: a shorter coaching line (free roamer B)
- Walkthrough of a drive's page in the Log on a phone: the plain-words coach line ran to five bold lines ("in 6 corners you rolled with neither brake nor gas between slowing down and speeding up; go straight from one to the other").
- Done: each habit and weak-spot fix in web/drive_view.js is a short clause ("you coasted between brake and gas in 6 corners; go from one straight to the other"); tests/test_drive_view.py holds the whole line to 140 characters.
- Next: keep walking the rest of the drive page (charts, corners list) on a phone.

# CALL SHEET

## 2026-11-12 Shorter drive coaching line (free roamer B)
- What: shorter HABIT and WEAK texts in web/drive_view.js plainCoach.
- Why: the owner's rule against walls of text; the old line was about 190 characters in bold.
- Undo: restore the old HABIT and WEAK strings and the test expectations in tests/test_drive_view.py.
