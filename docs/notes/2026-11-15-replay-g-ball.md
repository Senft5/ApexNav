# STATE

## 2026-11-15: the replay panel, the g-ball first
- Nate after a real free drive: "replay screen is kind of cluttered", "g ball should be more prominent", "some of the metrics are a little confusing maybe or disorganized".
- In a replay (`#app.replaying`, portrait), the binnacle is now in three plain tiers:
  1. The g-ball, the hero, on the left. Beside it, the speed and its limit.
  2. Under the speed, on a raised card, what the ball shows in words: "Turn 0.32 g right" and "Brake 0.18 g" or "Gas 0.23 g". Under 0.03 g these read "Straight" and "Coasting"; unknown stays "--".
  3. One ledger line: the trip (without the odometer's leading zeros), the road and the Score.
- Steps aside in a replay: the 0 to 140 speed ruler (the speed a second time) and the Sight cell. Sight is still on the plate under the arrow on the map.
- At night the trip shows in a replay; the quiet Trip key is for driving.
- On a drive, and on a phone on its side, the panel is unchanged.
- The panel is 219 px tall, as before (220), so the map keeps its band.
- Code:
  - `gReadout()` is in instruments.js (exported), and mountLine adds `.g-read`.
  - The layout is CSS in index.html; it is hidden outside a replay.
  - The g-ball's explain text mentions the replay's words.
- Shots: /mnt/project-files/ui-thread/replay-before-after-day.png and replay-before-after-night.png.

# CALL SHEET

## 2026-11-15: the replay hides Sight and the speed ruler
- What: in a replay the binnacle drops the Sight cell and the speed ruler. The g-ball becomes the hero, with labelled Turn and Brake/Gas values.
- Why: Nate asked for less clutter and a more prominent g-ball. Sight already rides under the arrow, and the ruler repeats the numeral. The e2e flow that tapped Sight to explain it in a replay now taps the g-ball. Sight's colours are still checked.
- Undo: delete the `#app.replaying .cluster-line` block in web/index.html. The readout then stays hidden.
