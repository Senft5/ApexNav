# STATE

## 2026-11-14: With no signal, the kept camera list still counts
- Done: `web/cameras.js load` used to drop a camera tile kept on the phone after a week, so a saved route driven in a dead zone more than a week after it was planned had no camera calls. Now, when no source answers (no signal, or our list and every Overpass server down), the kept tiles up to 90 days old are used, and the list carries `keptAt` (the oldest tile's time). The Layers sheet note then reads "Camera map from Nov 2, no signal to check for newer ones." A tile never kept, or older than 90 days, still makes the whole answer unknown (null), never a partial map. With signal, a week-old tile is asked for again as before. Tests: tests/test_cameras.py.
- Next: none here.

# CALL SHEET

## 2026-11-14: A camera list kept up to 90 days counts when nothing answers
- What: an expired kept camera tile (past its week) is used when no source answers, up to 90 days, and the note says when it was kept.
- Why: enforcement cameras are fixed hardware that changes over months; an old list with its date beats "no pins" on a road with no signal, and the date keeps it honest.
- Undo: the `if (!json)` fallback in web/cameras.js load (OLD_MS).
