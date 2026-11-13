# STATE

## Service check: a probe the app was hidden through is not judged (2026-11-13)
- Done: web/service_check.js fairProbe marks a probe "skip" ("the app was in the background, so not judged") when the page went hidden while it ran (cockpit.js passes `away()`, a count of visibilitychange-to-hidden). The auto-run no longer starts on a hidden page. Why: Nate's two "Long way: graph router timed out" rows (544 s, 235 s; 2026-11-12 20:53 and 2026-11-13 09:50 UTC) were the phone or tab going away mid-check, so the router's own timer and ours fired together on return.
- Next: read the next runs in D1 (`error_counts` kind 'service'); a Long way "down" that is not a skip is real and goes to the Routing thread.

# CALL SHEET

## Hidden-page probes are skipped, not judged down (2026-11-13)
- What: a probe that overlapped the page being hidden reports state 'skip'. Why: timers stop while hidden, so the time and any timeout are fiction. Undo: drop `away` from serviceCheckDeps in web/cockpit.js.
