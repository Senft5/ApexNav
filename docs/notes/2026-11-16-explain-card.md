# STATE

## 2026-11-16 The explain card leads with the reading
- Done: tapping an instrument (parked or in a replay) opens a card whose reading comes first, big, in a well under a small NOW; then what it means; "How it's measured" waits behind one tap instead of a second paragraph.
- Next: the end card; the convoy calls in the Report sheet (project files ui-thread/screen-inventory.md).

# CALL SHEET

## 2026-11-16 How an instrument is measured is one tap away
- What: index.html wraps `#explainHow` in `<details class="explain-how">` (closed each time the card opens); `#explainNow` is a `<small>Now</small>` and a `<b>` value in a well. cockpit.js openExplain builds it; e2e expects "Now BANK --". The words (instruments.js EXPLAIN) are unchanged.
- Why: Nate, 2026-11-16, no walls of text; the card was two grey paragraphs with the reading as a small line.
- Undo: revert the explain-card rules in index.html and openExplain's two lines.
