# STATE

## 2026-11-14 Live ghost duels against friends, step 1: the ghost on the drive
- Done: a stage result now carries its splits and its road surface (migration 0062: `board_entries.splits`, `board_entries.surface`). The splits are cut only at the run's corner apexes, at least 100 m apart, plus the finish (web/ghost_duel.js `cutsOf`), and are stored only where the time is shared (`share_times`). `GET /api/board/ghosts` returns, per stage, a friend's quickest run with splits on a road like yours, with a friend in an open duel first. While you drive one of your stages, the drive bar shows "−1.2 s vs @sam", and with full notes on the co-driver says how you stand half way and at the finish. The live gap moves at each of the friend's split points. A wet or icy road asks for wet runs only. Tests: tests/test_ghost_duel.py, backend/test/ghosts.test.ts, e2e "a ghost duel".
- Next: the drive page shows corner by corner against the friend (`cornerSplits`, your pass cut every 25 m on the phone). After that comes a "Challenge back" key on that result; the Social thread adds it, so tell them the hook when it exists. Migration 0062 must be applied to production before this merges.

# CALL SHEET

## 2026-11-14 A shared run's splits are cut at its corners only
- What: a friend sees your time at each corner apex (100 m apart at least) and at the finish, never at even 25 m steps. Why: about.html promises "No top speeds". Time between two apexes always holds a corner, so no straight's own speed can be worked out. Undo: web/ghost_duel.js `cutsOf` (and the analysis job's cuts).

## 2026-11-14 The live gap moves at the ghost's splits, and is held between them
- What: the bar's gap is taken as you pass each of the friend's split points, and is not interpolated in between. Why: between two corners a straight-line guess of the friend's time would swing the gap for no reason. Undo: ghost_duel.js createTracker.

## 2026-11-14 The ghost bar takes over from the stage and stretch bars
- What: on a stage with a friend's ghost, their gap shows in place of your own technique delta. Your technique delta is still said at the end. Why: one bar at a time, and the owner asked for time duels. Undo: cockpit.js feedGhost and feedStage (`!$('ghostBar').hidden`).
