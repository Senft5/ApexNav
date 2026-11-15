# STATE
## Session 2026-11-15 (off-map copy): the off-map messages name the 48 mainland states, and no loop offers the best roads (claude/project-thread-39xbx9)
- Done: web/cockpit.js. Fun, Long way and loops off our map say it covers the 48 mainland US states, not "Ohio, Kentucky and Indiana so far". When no loop of the asked length exists from the start (Big Sur, Moab, Ouray: their good roads run out and back), the message has a Best roads key that opens Best roads nearby (not on the car, which says the message).
- Next: the lower-48 context grid build (ctx-us.yml), then a graph-us rebuild scored with it.

# CALL SHEET
## 2026-11-15 (off-map copy): no loop points at Best roads nearby, not a there-and-back (claude/project-thread-39xbx9)
A there-and-back dressed as a loop would be cut to nothing by removeSpurs and isn't what Loop promises; Best roads nearby already leads to the good roads in reach. Undo: drop the action argument of that toast in loopNow's fallback in web/cockpit.js.
