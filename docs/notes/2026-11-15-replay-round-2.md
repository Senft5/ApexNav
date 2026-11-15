# STATE

## 2026-11-15 Replay round 2 (the real-drive critique)
- Done: the G-ball grows to 148px (112px on screens under 740px tall, so the map keeps its band); an unknown limit sign and an unknown Score are hidden in a replay, not shown as "--"; the play key is a round glyph key (pause bars while playing, a triangle while paused, a replay arrow at the end); the note strip slides away when no note is up; a "Jump to the corners" pill skips a long run-in to 400 m before the first run of corners.
- Shots: project files ui-thread/replay-r2/ (before/after, day and night).
- Next: a single-row transport with one cycling speed key (e2e pins the 1x/2x/4x/8x radiogroup and Done, so it needs those flows rewritten); a centred hero G-ball layout.

## 2026-11-15 Real-drive review round 2 (Nate's own drives), UI items
- Done: the note strip shows a bump, crest or dip only inside twice the voice's lead for it (at least 200 m), and only one at a time; in a replay the map's Sight plate shows only from 400 m before a corner to 150 m into it; Jump to the corners stays up until 700 m before the corners (a city start); the Log folds drives under 1 mi with no corners under "Short drives (n)", labels Score over time once per day (44 px apart at least), and its hero is the latest Score and its day with "Best n" as a chip only when the best is higher, with no drive names (a route's name is a home address).
- Next (other owners): drive names after the twistiest road (critique item 3), the scoreboard's "best" vs "quickest" (item 2), a `said` log for the voice (item 6).

# CALL SHEET

## 2026-11-15 Replay: hide what a replay can't know, add Jump to the corners
- What: in a replay the empty limit sign and Score "--" are hidden; the note strip hides when quiet; play becomes a glyph key; "Jump to the corners" appears while the cursor is over 1 km before the first run of three corners within 1.5 km.
- Why: the real-drive review called the replay cluttered; empty values and an idle strip were noise, and a free drive's run-in is minutes of nothing.
- Undo: the `#app.replaying` rules in web/index.html (ro-limit.unknown, g-score.unk, .notes:has(.note-quiet)) and `paintJump`/`cornersStartM` in web/cockpit.js.

## 2026-11-15 Replay: kept the hazard banner and the two-row transport
- What: the hazard shows both in the note strip and as a map pin; the transport keeps play + scrubber on one row and speeds + Done on the next.
- Why: the strip is the pace note the driver hears (the pin only marks where); one cycling speed key hides the choices behind repeated taps and the e2e contract pins the radiogroup.
- Undo: revisit in a later round if the review still finds it busy.

## 2026-11-15 Strip hazards only inside the voice's lead
- What: a measured hazard (bump, crest, dip) shows in the strip only within max(200 m, 2 x leadM) and never two at once, live and in a replay; the Log hero drops drive names and shows Best as a chip.
- Why: Nate's real free drive showed two BUMP cards from 0.9 mi out for a whole mile of 35 mph arterial; the Log hero showed a home address in big type.
- Undo: `hazardNear` in web/cockpit.js renderNotes block; `historyCards` in web/analysis_page.js.
