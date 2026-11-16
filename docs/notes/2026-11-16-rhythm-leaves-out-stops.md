# STATE

## Rhythm leaves out corners by a stop (2026-11-16)
- Nate asked whether Rhythm (the Driver Score's consistency, 20 %) marks him down for public-road stops: signs, lights,
  traffic. Measured on his 13 drives: yes. 22 of 154 scored corners had a stop (under 2.5 m/s) within 100 m before or
  50 m after them, mostly slow junction turns (use 0.11 to 0.5), and they widened the spread Rhythm measures.
- core/drive_analysis.py corner_technique (and its port web/apex_core.js cornerTechnique) now marks such a corner
  `near_stop`; driver_score / techniqueScore take Rhythm from the other corners while two or more remain (all corners
  otherwise, so one corner never gets a free full Rhythm). The corner still counts for pace, smoothness and braking.
- Effect on his drives (Score): 10-30 16:21 650 to 674, 10-31 18:10 589 to 604, 11-03 17:22 632 to 652, 11-14 22:58
  657 to 682; but 11-11 735 to 723, 11-14 22:40 648 to 639, 11-03 16:10 637 to 635 (their stop corners were the
  even ones). A measurement fix, not a lift: it goes both ways.
- Checked and NOT changed: bends taken without slowing (capped by the limit or traffic, 15 corners) do not drive the
  spread (sd 0.15 vs 0.20 for corners he slowed for), so leaving them out would only flatter. Traffic without a stop
  cannot be told from choice in the data, so it stays counted. Most of his low Rhythm (0.15 to 0.3 on long drives)
  comes from corners where he chose the pace.
- SUMMARY_VERSION 5 (web/recording.js): every stored drive is scored again; the cheap shape-only upgrade for version 2
  and 3 summaries is gone (their scores predate this).
- Tests: tests/test_rhythm_stops.py (stop before, stop after, a stop 150 m back still counts, under two chosen corners,
  JS parity); e2e "the Log list" now expects old summaries scored again.

# CALL SHEET

## Rhythm leaves out corners with a stop within 100 m before or 50 m after (2026-11-16)
- What: those corners are not part of the consistency spread; the rest of the Score is unchanged.
- Why: their pace was set by a sign, light or traffic (Nate 2026-11-16); validated on his drives, moves Scores both ways.
- Undo: STOP_BEFORE_BINS / STOP_AFTER_BINS to 0 in core/drive_analysis.py and web/apex_core.js, and bump SUMMARY_VERSION.
