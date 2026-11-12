# STATE
## Session 2026-11-12 (roam-a loop window): a time attack loop's lap is found however GPS lands (claude/project-thread-h7xxmf)

- Bug: the Log times stage runs on the phone (analysis_client.js passes → Core.segmentPass), and those times go to the
  time attack boards. `segment_window` (core/drive_analysis.py) and its port `segmentWindow` (web/apex_core.js) matched
  a stage's start at the single closest sample of the whole drive. On a loop the end is the start, so the closest visit
  to the start is often the way back round, with no lap after it, and the lap was missed: no Log time and no board time.
  That depends on GPS noise, so it fails about half the time. A stage driven twice had the same problem.
- Fix: every visit to the start (each run of samples within MATCH_RADIUS_M, its closest sample) is tried, closest first.
  The first that ends at the stage's end at a plausible length wins. When the old match was valid it is still the first
  tried, so point-to-point stages give the same answer as before.
- core: `nearest_index` returns (lo, inf) for a window past the path's end instead of raising. The JS port already did.
- Tests: tests/test_drive_analysis.py +1 (a 2 km circle driven 1.3 times, the first lap's GPS 3 m wide; it fails without
  the fix); tests/test_web_core_parity.py +1 (the same in both cores).
- Next: another roam item.

# CALL SHEET
## 2026-11-12 (roam-a loop window): with several passes over a stage, the closest one to the start counts (claude/project-thread-h7xxmf)

When a drive passes a stage more than once, segmentPass still returns one pass: the first valid one, trying the visit
closest to the start first. It does not pick the fastest. Picking the fastest would change which time a board gets, and
the boards belong to the social thread. Undo: restore the single global nearest in segment_window and segmentWindow.
