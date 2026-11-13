# STATE

## 2026-11-13 Drive page: the corner overlay, this pass against your best pass
- Done: on a drive's page, tapping a corner that you have driven better on another drive (a corner card, a Where to find time row or a repeatability row) opens it under the row: this pass's speed against your best pass's speed along the same road (lined up by position, not time), each pass's braking point and slowest point marked, and the time between them building through the corner; then labelled rows ("Braking: 85 m before the middle · best pass 70 m", "Slowest: 36 mph, … · best pass 39 mph, …", "Through the corner: 0.9 s slower than the best pass"). A second tap closes it. New pure module web/corner_trace.js (tests/test_corner_trace.py), the worker's `cornerTrace` job (web/analysis_client.js), `overlaySvg` in web/drive_view.js; apex_core.js now also exports `matchWindow` and `nearestIndexWin`. e2e in "a drive's corners on a road driven four times".
- Next: the same overlay against a friend's pass on a shared stage; the video big bet (#5 in docs/notes/2026-11-13-big-bets.md).

# CALL SHEET

## 2026-11-13 Corner overlay computed on tap, in the worker
- What: the overlay's traces are worked out when a corner is tapped (the worker's `cornerTrace` job, which redoes the drive's coach to find the best pass), not with the drive job. Why: 36 corners of traces would ride on every drive page open for the one or two a driver taps. Undo: compute `T.trace` per corner in the `drive` job and pass the traces in `coach`.
