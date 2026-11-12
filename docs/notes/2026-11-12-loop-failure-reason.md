# STATE

## 2026-11-12 A loop our router fails is told apart from "no loop that length" (claude/project-thread-39xbx9)
- `own_routing.js` `loops` keeps the worker's error in `ApexOwnRouting.lastLoopError` (null when it answered). The
  cockpit reports `loop: failed (<length>, <error>)`, `loop: rejected (<length>)` (loops found, none survived the build or
  scoring) or `loop: none (<length>)`. The toast for a failure says "couldn't finish ... Try again, or a shorter one".
- The loop ask to the router worker waits 20 s, not 8 (it loads every tile the length can reach).
- Next: when a `loop:` report comes in, read the reason and the length in error_counts (kind 'route').

# CALL SHEET

## 2026-11-12 A loop our router fails to finish says so, and waits longer (claude/project-thread-39xbx9)

Nate's first report was `loop: none`, but a worker error or timeout was reported the same way and told him to try another
length. Now a failure is `failed` with the error, and the length asked rides with every loop report (never a place).
Call: loops get 20 s (a plan keeps its 6 s): a loop is asked for on purpose with a progress bar, and a long one loads
many tiles. Undo: the `20000` in graph_router.js client `loop`, and `failed`/`rejected` in cockpit.js buildLoop.
