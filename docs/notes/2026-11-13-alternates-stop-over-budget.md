# STATE

## 2026-11-13 Plans 15 to 23 % faster: an alternate over the budget ends the alternates (claude/project-thread-39xbx9)
- `graph_router.js` `planNow`: the penalty alternates (x1.6, x2.5, x5 on the chosen edges) stop at the first one over
  the level's time budget. A larger penalty only sends the next search further from the chosen roads, and each of
  these searches settles most of the corridor (the heaviest searches of a Long way plan: 110 to 140 ms each of about
  1.1 s on the service check's Cincinnati pair, the same 1,067-edge route found three times and thrown away three times).
- Checked on the bundled Cincinnati tiles, 16 random trips at Fun and Long way: the same best route and the same route
  list in all 32 plans, and 15 to 23 % less planning time over two runs (21.8 s to 16.7 s, 22.1 s to 18.8 s); the service check's Long way pair 1.14 s to 0.87 s.
- Next: skipping the cheaper-end steps (K.LOWER) between two weights that found the same route measured no gain; the next step is a faster search itself (each settles 100k+ edges on Long way).

# CALL SHEET

## 2026-11-13 Stop the penalty alternates at the first one over the budget (claude/project-thread-39xbx9)

Not exact in theory (a larger penalty could find a different, quicker way round), but in 32 real plans it changed
nothing, and the time goes where phones run out of it (the Long way timeouts). Undo: `if (r.timeS > limitS) continue;`
in planNow's alternates loop.
