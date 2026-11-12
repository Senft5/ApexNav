# STATE

## 2026-11-12 A stage's Board: fewer words, none of them stale

- Done: the empty friends board says "No friends on this stage yet." (it went on about sharing and an "Account" page that is People now). The note under the board ("Your stages are backed up. Scores are shared only with friends you choose (Account).") is gone; a fresh backup still says "Backed up N stages.". The Runs table's head says "Time", not "Time (private)": since 2026-11-11 friends and private crews see times by default. e2e checks the sentence and that no "(Account)" is left on the board.
- Left: web/privacy.html still names "(Account)" for Download my data and Delete account; that page belongs to the privacy work, not this thread.
- Next: keep decluttering the social surfaces (Nate 2026-11-12, no walls of text).

# CALL SHEET

## 2026-11-12 "Time (private)" is just "Time"

- What: dropped "(private)" from the stage Runs table's Time column.
- Why: it was untrue after Nate's 2026-11-11 call (sharing with friends and private crews on by default, times included).
- Undo: restore `Time <small>(private)</small>` in the segTable head in web/analysis_page.js.
