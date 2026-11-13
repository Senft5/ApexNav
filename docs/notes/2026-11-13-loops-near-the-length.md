# STATE

## 2026-11-13 Loops land near the length asked (claude/project-thread-39xbx9)
- On the bundled Cincinnati tiles, 24 loop asks (25 to 90 km, Fun and Long way): 5 of 24 had no loop within 25 % of the
  length (90 km asked gave 109 to 131 km), and the loop a ranking like the card's would pick missed by 19 % on average.
- Why: `loopCombos` weighed length by `1 - 1.5 x off`, so three good roads 40 % over outscored one road on the length,
  and only the 8 best stages were combined.
- Now (`graph_router.js` `loopNow`, `loopCombos`):
  - length credit is `1 / (1 + (off / 0.12)^2)` (half at 12 % off, a fifth at 25 %), and 12 stages are combined;
  - none within 15 %: the stages are picked again for the length the routed loops say this ground needs (median routed
    over estimated), and the nearest loops are re-driven with quicker connectors (too long) or freer ones (too short);
  - none within 30 %: the rings (aimed at the length) join the candidates.
- Same 24 asks: every one has a loop within 25 % (was 19), 20 within 15 % (was 14); the picked loop misses by 10 % on
  average (was 19 %), with goodness 0.381 (was 0.369) and the same fun per km. About 50 % more router time
  (0.25 to 0.38 s each on a laptop).
- Tests: `test_graph_router.py` loops land near the length asked on real tiles (fails on the old code).

# CALL SHEET

## 2026-11-13 Loop length counts more when choosing stages (claude/project-thread-39xbx9)

A loop's length is the one number the driver asked for, so a combination far off it should not beat one on it just by
holding more good road. The card's ranking still weighs length against roads. Undo: `LOOP_FIT_OFF` large and
`LOOP_STAGES` 8, or drop the second round in `loopNow`.
