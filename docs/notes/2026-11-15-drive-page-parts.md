# STATE

## 2026-11-15 Drive page in three parts
- Done: the drive page (analysis.html, drive_view.js) reads as How you drove / The road / Yours, each with a small label. How you drove holds the Score with the grip circle beside it, the duel, Your touch and Against your records. The road holds the map, the chart, the corners, This road over time and friends on the road. Yours holds tags, the note, the dashcam and Your notes. The grip circle lost its paragraph and its "What the grip circle shows" explainer: a tap on it says the vocabulary's one line, and the outline's numbers are its spoken label. The Score's four parts are buttons: the line under them says "Each part out of 100" and a tap says what one means (vocabulary.js). Tags fold behind "+ Tag" until one is chosen. From Nate's "metrics confusing and disorganised" (critique round 1, project files drive-review/). Tests: tests/test_drive_view.py, e2e "drive tags", "drive ended: the card and the Log", "REVIEW.md 1.2 screen by screen: the Log".
- Done: one chart at a time, picked from a row (Speed, Turning, Pedals, Road, Height) in place of the stacked lanes. How fast the load changed has one spelling, g a second, and a word first on one scale (vocabulary.js rateWord: gentle under 0.4, firm, sharp from 1), for the abrupt moments and Your touch. Each corner row leads with how it went (driver_profile.js cornerResult: "Clean 94", "Coasted before the gas 82"), then the call and the speed; the "0.01 mi" is gone, since the number on the map says where. Tests: tests/test_corner_result.py, tests/test_vocabulary.py, e2e "a drive's elevation lane", "a drive's corners on a road driven four times".
- Next: round 2 with Nate's own drives once his phone uploads them (drive-review thread); Your driving's touch lines could take the same words.

# CALL SHEET

## 2026-11-15 The grip circle explains itself on a tap, not in a paragraph
- What: dropped the circle's lede and its five-paragraph explainer (TestFlight 14 asked what it means). Why: Nate's critique round 1 asked for the circle up by the Score with no paragraph; the vocabulary's one line still answers TestFlight 14, one tap away, in the line under the Score's parts. Undo: web/drive_view.js ggView (git history has the explainer).

## 2026-11-15 A corner's result is judged on the skills it has
- What: a corner row's number is the mean of the skills measured there (three at least, the arc and the entry among them); a corner with no braking is judged without its braking skills. The records (Against your records) still need all six. Why: most corners on a real drive have no braking run, and a row that says nothing for them would leave the list as call words again. Undo: driver_profile.js cornerResult (all six, as driveRecords does).

## 2026-11-15 One scale of words for g a second
- What: gentle under 0.4, firm to 1, sharp from 1 g a second, for the abrupt moments and Your touch alike. Why: "1.4 g/s" and "0.2 g a second" were one unit spelled two ways and neither said what it meant. Undo: vocabulary.js rateWord.
