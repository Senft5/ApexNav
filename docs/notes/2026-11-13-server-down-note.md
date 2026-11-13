# STATE

## 2026-11-13: the app says once when the server hit its free daily limit
- When Workers Free's daily D1 limit is hit, the API answers 503 `service_unavailable` until midnight UTC (#616). The app showed "Couldn't ... Try again" or "Check signal" on every tap, which reads as the phone's fault.
- web/sync.js apiFetch now notices that answer (from its JSON body, since the iOS bridge drops headers) and fires `apex:server-down` once per outage, ending at the next midnight UTC. The cockpit shows one held toast: "Sharing is down until 7:00 PM: our server hit its daily limit. Driving and notes still work." (local time). Any other 503 says nothing. tests/test_server_down.py.
- Next: the Workers Paid decision (owner) removes the cause.

# CALL SHEET

## 2026-11-13: one toast for the daily-limit outage
- What: a single 10 s toast with OK, the first time a 503 service_unavailable comes back; no banner, no repeat until the next outage.
- Why: honest about whose fault it is, without a wall of text; driving needs no server.
- Undo: remove the `apex:server-down` listener in web/cockpit.js (sync.js then fires an event no one hears).
