# STATE

## 2026-11-13 Drive page: shorter grip circle line and abrupt-moment advice (free roamer B)
- Walkthrough of a drive's page on a phone: the grip circle opened on a three-line paragraph above a "What the grip circle shows" expander that says it all again, and each Most abrupt moments card spent two lines on one piece of advice ("the throttle went on sharply here: squeeze it on more progressively").
- Done: the grip circle's one line (web/vocabulary.js gripCircle.meaning) is shorter; web/drive_view.js abruptAdvice says each in one short clause ("the throttle went on sharply: squeeze it on"). tests/test_drive_view.py passes; the e2e Your driving flow's shared-advice check is updated.
- Also shorter (web/analysis.html): the notes under Your notes, Your touch on this drive and Against your records, each now one line on a phone.
- Next: keep walking on a phone.

# CALL SHEET

## 2026-11-13 Shorter drive-page advice (free roamer B)
- What: the grip circle line and the abrupt moments' advice cut to one short clause each.
- Why: the owner's "walls of text" rule; the expander keeps the full explanation.
- Undo: restore the old strings in web/drive_view.js abruptAdvice and web/vocabulary.js gripCircle.meaning, and the e2e regex.
