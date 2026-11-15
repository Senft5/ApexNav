# STATE

## 2026-11-15 Replay round 3: the transport on one row
- Done: the replay's controls are one row, as on any player: the round play key, the scrubber, one speed key that steps 1x, 2x, 4x, 8x on each tap (the radiogroup keeps its four radios for VoiceOver; only the chosen one shows) and Done. Video floats over the map's bottom left, as Jump to the corners does on the right. The map gains the old second row (about 56 px).
- Shots: project files ui-thread/replay-r3/.
- Next: the G-ball's "BRAKE" axis label reads as a state beside "Gas 0.07 g" in the readout; consider a smaller axis mark or none in a replay.

# CALL SHEET

## 2026-11-15 One cycling speed key in the replay
- What: the speed detents show only the chosen speed; tapping it steps to the next (8x wraps to 1x). The e2e "Vetta Line" flow now checks one key, one row.
- Why: the real-drive critique (round 1 item 4) asked for one transport row with a cycling speed key; four speed keys and Done took a row of their own on a phone.
- Undo: the `.transport` one-row rules in web/index.html and the `pick` step in the `#rateDetents` click handler in web/cockpit.js.
