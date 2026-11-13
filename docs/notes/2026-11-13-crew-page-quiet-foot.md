# STATE

## 2026-11-13 Crew drive cards: the date at the top of its column (free roamer B)
- Walkthrough of a crew page on a phone: an upcoming drive's date floated halfway down its tall black column (the card is tall with the Going switch and More), so it read as misaligned beside the title.
- Done: web/crew_events.js .cp-date sets the day and month at the top of the column, as a calendar page (the same card on the Crews dashboard). The e2e "crew page" flow checks it. (The lone "Plain livery" line I also saw was removed meanwhile by #630.)
- Next: keep walking on a phone.

# CALL SHEET

## 2026-11-13 Crew drive card date at the top (free roamer B)
- What: a drive card's date sits at the top of its column, not centred.
- Why: centred in a tall card it floated away from the title it dates.
- Undo: `place-content: center` and no padding-top on .cp-date in web/crew_events.js.
