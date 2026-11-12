# STATE
## Session 2026-11-12 (slow connections): the website opens from its kept copy when the network answers nothing (claude/project-thread-g9yher)
- Done: web/sw.js is network first, but it waited for as long as the browser did. On a connection that answers nothing (hotel or roadside "lie-fi") the page stayed blank for minutes, even with a kept copy. Now, when a copy is kept, it waits 5 s (`SLOW_MS`) for the network, then serves the copy; the late answer still updates the cache for the next load. With no copy, the network gets all the time it needs, as before.
- `tests/test_service_worker.py` covers a connection that never answers.

# CALL SHEET
## 2026-11-12: 5 s before the kept copy
- What: `SLOW_MS = 5000` in web/sw.js.
- Why: long enough that a slow but working connection still gets the fresh deploy, short enough that a dead one doesn't look like a broken app.
- Undo: delete the race in the fetch handler (go back to awaiting `fetch(req)`).
