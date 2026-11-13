# STATE

## Service check: what ran while the app was hidden is asked again once it is back (2026-11-13)
- Done: runServiceCheck (web/cockpit.js) re-runs the probes judged "skip … background" once the page is shown again (waits up to 10 min, `svcShown`), and only then sends the report. e2e flow "service check: what ran while the app was hidden …". Why: a 19:03 UTC run on 2026-11-13 had Fun "graph router timed out" at 600 s, the same lock-screen artifact as #608; skipping alone would leave the router unanswered on most runs.
- Next: read the next runs in D1; a router "down" now means the router really failed on screen.
