# STATE
## Session 2026-11-12 (roam-a loop delta): the live delta on a time attack loop no longer ends as it starts (claude/project-thread-h7xxmf)

- Bug: a fixed time attack saved to your Log (time_attack.js localCopy) is a stage whose end is its start. The live
  delta (web/stage_delta.js createTracker) ended a pass at the closest approach to the end, which on a loop is the moment
  you enter it: "Loop done." showed at the start (twice on the test loop), then the pass began again from a few metres in.
- Fix: the end only counts once the pass has covered half the stage's length. A point-to-point stage is unchanged.
- Tests: tests/test_stage_delta.py +1 (a 2 km loop with esses: one "done", every corner scored, at the end); it fails
  without the fix. The e2e "a saved stage: the live delta…" passes.
- Next: chargers on CarPlay's preview (passed to the CarPlay thread), or another roam item.
