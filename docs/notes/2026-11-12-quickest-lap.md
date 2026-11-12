# STATE
## Session 2026-11-12 (time attack): a drive's quickest lap counts (claude/project-thread-uwmi4e)
- Done: with several passes over a stage in one drive (laps of a time attack loop, a stage driven twice), segment_pass / Core.segmentPass take the quickest, not the first found. New segment_windows / segmentWindows list every pass; segment_window keeps returning the first, so stage_delta's reference is unchanged. Parity-tested.
- Next: back to the social declutter pass.

# CALL SHEET
## 2026-11-12 (quickest lap): the best of a drive's passes (claude/project-thread-uwmi4e)
Left open by #526: a drive with several laps gave the first valid one. The boards and the Log keep your best, so the drive's quickest pass is the one sent; a tie keeps the first found. Undo: revert this PR (segment_pass goes back to the first window).
