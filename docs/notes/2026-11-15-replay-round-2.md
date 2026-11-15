# STATE

## 2026-11-15 Replay round 2 (the real-drive critique)
- Done: the G-ball grows to 148px (112px on screens under 740px tall, so the map keeps its band); an unknown limit sign and an unknown Score are hidden in a replay, not shown as "--"; the play key is a round glyph key (pause bars while playing, a triangle while paused, a replay arrow at the end); the note strip slides away when no note is up; a "Jump to the corners" pill skips a long run-in to 400 m before the first run of corners.
- Shots: project files ui-thread/replay-r2/ (before/after, day and night).
- Next: a single-row transport with one cycling speed key (e2e pins the 1x/2x/4x/8x radiogroup and Done, so it needs those flows rewritten); a centred hero G-ball layout.

# CALL SHEET

## 2026-11-15 Replay: hide what a replay can't know, add Jump to the corners
- What: in a replay the empty limit sign and Score "--" are hidden; the note strip hides when quiet; play becomes a glyph key; "Jump to the corners" appears while the cursor is over 1 km before the first run of three corners within 1.5 km.
- Why: the real-drive review called the replay cluttered; empty values and an idle strip were noise, and a free drive's run-in is minutes of nothing.
- Undo: the `#app.replaying` rules in web/index.html (ro-limit.unknown, g-score.unk, .notes:has(.note-quiet)) and `paintJump`/`cornersStartM` in web/cockpit.js.

## 2026-11-15 Replay: kept the hazard banner and the two-row transport
- What: the hazard shows both in the note strip and as a map pin; the transport keeps play + scrubber on one row and speeds + Done on the next.
- Why: the strip is the pace note the driver hears (the pin only marks where); one cycling speed key hides the choices behind repeated taps and the e2e contract pins the radiogroup.
- Undo: revisit in a later round if the review still finds it busy.
