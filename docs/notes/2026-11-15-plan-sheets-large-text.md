# STATE
## Session 2026-11-15 (plan sheets at large text): Where to?, its Options and Best roads nearby join the screen sweeps (claude/project-thread-dpdmcn)
- Done: `screensSweep` (the large text sweep at 1.5x and 2x, and the narrowest phone / on its side sweep) also opens Where to?, its Options sheet and Best roads nearby (from our tiles), and reads each.
- Fixed, found by it: at 2x on a 320 pt phone, Best roads nearby's "Within 15 min" ran over "Within 30 min". At large text a row of detents now sizes each key to its longest word and wraps the words, like the switches (#932). 1x is unchanged; the Tapedeck's rate row and the scrolling rows keep their own rules.
- Fixed in the tests: the sweeps' and the contrast-in-every-look flows' own phones set "What's new" seen with `'all'`, which the app never honoured, so the news sheet sat over the map they read. They now store the news's own id (`NEWS_ID`).
- Tests: full e2e locally; with the fix reverted the narrow sweep names the overlap.
- Next: another roam item.

# CALL SHEET
## 2026-11-15 at large text a row of detents sizes its keys to their words and wraps them
- What: index.html `html[data-type-size] .detents:not(.scroll):not(.tp-rate) > button { flex: 1 1 auto; min-width: min-content; white-space: normal }`.
- Why: equal-width keys with `nowrap` let "Within 15 min" run into the next key at 2x on a 320 pt phone.
- Undo: delete the rule (the narrow sweep names the overlap again).
