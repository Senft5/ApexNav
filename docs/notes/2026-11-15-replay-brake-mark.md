# STATE

## 2026-11-15 Replay: the ring's BRAKE mark goes
- Done: in a portrait replay the G-ball's "BRAKE" axis mark over the ring is hidden; the readout card beside the ball names the pedal (Brake, Gas or Coasting) with its g.
- Next: the route card's extra lines (the swipe hint and "Checked n routes") under the Quick/Fun/Long way picker.

# CALL SHEET

## 2026-11-15 No BRAKE axis mark in a replay
- What: `#app.replaying .cluster-line .g-line .dial-label { display: none }` (portrait replay only; the drive screen keeps it).
- Why: the round-3 replay shot showed "BRAKE" in big type over the ball while the card read "Gas 0.07 g", which reads as a contradiction.
- Undo: delete that rule in web/index.html.
