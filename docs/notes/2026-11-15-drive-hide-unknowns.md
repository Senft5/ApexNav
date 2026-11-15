# STATE

## 2026-11-15 The live drive screen hides what it can't know yet
- Done: as in a replay, the drive screen's cluster no longer shows "SCORE --", the "BANK –" figure under the G-ball, or an empty limit sign. Each appears once it is known; the trip holds the ledger line until then. Shots: project files ui-thread/drive-clean/.
- Next: the drive screen's 0–140 speed ruler (the critique dropped it in the replay; the drive keeps it for the limit and pace marks); the route card's extra lines.

# CALL SHEET

## 2026-11-15 Unknown Score, limit and Bank step aside on the drive screen
- What: `.cluster-line .ledger > .g-score.unk, .cluster-line .ro-limit.unknown { display: none }` and the Bank figure `visibility: hidden` while `.unk`, for every cluster-line layout (the replay had them since #914). The Vetta Line e2e checks the Score is not shown until known.
- Why: Nate's real-drive reviews: a framed dash is not news, and on a web-recorded drive Bank and the limit are always unknown, so two of five instruments were dead for the whole drive.
- Undo: delete the rule block after the night `.trip-peek` rule in web/index.html and restore the old ledger check.
