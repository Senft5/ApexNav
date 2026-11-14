# STATE

## 2026-11-14: arrival, time left and distance left as figures under the map
- On a route, the drive bar shows three big figures, as Apple and Google Maps do: the arrival ("4:39"), the time left ("10", "~10" while rough, "1:05" hr) and the distance left ("1.6" mi), with their units small under them. Recording and sharing move to a small line under them. Before, it was one sentence ("● Rec 0.78 mi · about 10 min left · 2:36 PM") that wrapped to three lines on a phone.
- Newly possible: reading the arrival and the distance left at a glance. The distance left wasn't shown anywhere in the drive bar before.
- Pure: `ApexEta.figures` (web/eta.js; tests/test_eta.py `test_trip_figures`). VoiceOver reads one sentence ("Arriving 4:39 PM, 10 min left, 1.6 mi to go.").
- e2e: the U-99 status-line flow now checks the three figures fit beside End at 320, 375 and 402 px in every theme, day and night. If a figure doesn't fit, it wraps under the others and never runs past End.
- Off a route, or with no router time: the status line is unchanged.

# CALL SHEET

## 2026-11-14: the arrival drops its AM/PM in the figures
- What: the arrival figure is "4:39", not "4:39 PM". The spoken sentence keeps the full time.
- Why: Apple Maps does the same, the hour is never ambiguous within a drive, and it saves the width the three figures need on a 320 px phone.
- Undo: in `figures` (web/eta.js), stop removing the AM/PM from `clock`.

## 2026-11-14: Report is narrower on 320 px phones
- What: below 341 px, the Report word's padding is 6 px instead of 12 px.
- Why: it gives the three figures room beside End in the wide Tapedeck font.
- Undo: remove the `@media (max-width: 340px)` rule for `#hzReportBtn` in web/index.html.
