# STATE
## Session 2026-11-12 (failed requests): plain words, and the privacy page names native crash reports (claude/project-thread-g9yher)
- Done: planning a route, opening a maps link, searching a place or re-planning for a new level used to toast the browser's own words when a request failed ("Load failed", "Failed to fetch", "NetworkError when attempting to fetch resource."). `errText` in web/cockpit.js now says "No connection. Try again when you have signal." (a bad server reply says "Something went wrong on our side"); our own messages pass through as written. `tests/test_error_text.py` keeps `toast(err.message)` out of web/*.js.
- Done: web/privacy.html "Crash reports" now says the iPhone app sends iOS's crash and freeze reports (#523): what kind, the build, where in the code; never a position, name or drive.

# CALL SHEET
## 2026-11-12: one line for every network failure
- What: every failed request in those five places reads "No connection. Try again when you have signal.", including a timeout (#538).
- Why: the browser's words differ by engine and mean nothing to a driver; one plain line says what to do.
- Undo: put `toast(err.message)` back in the five catch blocks and drop `errText`.
