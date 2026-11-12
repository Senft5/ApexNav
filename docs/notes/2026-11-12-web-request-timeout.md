# STATE
## Session 2026-11-12 (slow requests): the website gives up on a dead connection after 30 s (claude/project-thread-g9yher)
- Done: `apiFetch` in `web/sync.js` on the website now stops a request after 30 s (90 s for an upload or any other write), the same as the app's shell, whose URLRequest already times out at 30 s. Before, a browser on a dead hotel or roadside connection could wait minutes with the spinner up.
- A timeout throws the same `TypeError('Load failed')` as being offline, so every existing offline path (queued uploads, cached road book, the offline toasts) handles it with no new code. A caller's own `signal` still wins.

# CALL SHEET
## 2026-11-12: 30 s / 90 s web request timeout
- What: `AbortSignal.timeout` on website requests, 30 s for reads, 90 s for writes (a drive upload on a slow link can take a while). Browsers without `AbortSignal.timeout` keep the old behaviour.
- Why: match the app shell so both behave the same, and let the offline paths take over instead of hanging.
- Undo: remove the `signal` line in `apiFetchOnce` (web/sync.js).
