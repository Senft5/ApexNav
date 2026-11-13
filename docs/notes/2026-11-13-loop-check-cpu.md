# STATE
## Session 2026-11-13 (security): the time attack loop check fits a free-plan Worker better (claude/project-thread-4lms1f)
- backend/src/loop_check.ts (#566) cost 17-31 ms of CPU cold and up to 27 ms warm for a 15-25 km loop, past Workers Free's
  10 ms. Now: samples every 200 m (was 100) and at most MAX_SAMPLES = 60 on a longer loop; a tile's edges are picked by a
  sample bitmap with summed counts (four reads an edge, in scanEdges, a small function V8 optimises early) instead of reading
  every line in the loop's box. Measured on the shipped Cincinnati tiles (node): warm 2-8 ms, cold first call 8-20 ms.
- Same verdict as the old check on 60 random loops over every shipped tile (scratch compare, not in the repo).
- Still open: the very first check on a fresh isolate can run past 10 ms on a long city loop. Cloudflare allows infrequent
  overruns and a loop is posted about once per area per season. Next, if it shows up as errors: skip (unchecked) past 4 tiles.

# CALL SHEET
## 2026-11-13 (security): the loop check samples sparser on long loops (claude/project-thread-4lms1f)
Every 200 m, at most 60 points: a hand-drawn loop leaves the roads for kilometres, which 60 points still catch, and the
check's CPU grows with the points. Undo: SAMPLE_M and MAX_SAMPLES in backend/src/loop_check.ts.
