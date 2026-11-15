# STATE

## 2026-11-15 Drive page in three parts
- Done: the drive page (analysis.html, drive_view.js) reads as How you drove / The road / Yours, each with a small label. How you drove holds the Score with the grip circle beside it, the duel, Your touch and Against your records. The road holds the map, the chart, the corners, This road over time and friends on the road. Yours holds tags, the note, the dashcam and Your notes. The grip circle lost its paragraph and its "What the grip circle shows" explainer: a tap on it says the vocabulary's one line, and the outline's numbers are its spoken label. The Score's four parts are buttons: the line under them says "Each part out of 100" and a tap says what one means (vocabulary.js). Tags fold behind "+ Tag" until one is chosen. From Nate's "metrics confusing and disorganised" (critique round 1, project files drive-review/). Tests: tests/test_drive_view.py, e2e "drive tags", "drive ended: the card and the Log", "REVIEW.md 1.2 screen by screen: the Log".
- Next: one chart with a picker instead of the stacked lanes; one spelling of g a second, said in words; corner rows lead with how the corner went.

# CALL SHEET

## 2026-11-15 The grip circle explains itself on a tap, not in a paragraph
- What: dropped the circle's lede and its five-paragraph explainer (TestFlight 14 asked what it means). Why: Nate's critique round 1 asked for the circle up by the Score with no paragraph; the vocabulary's one line still answers TestFlight 14, one tap away, in the line under the Score's parts. Undo: web/drive_view.js ggView (git history has the explainer).
