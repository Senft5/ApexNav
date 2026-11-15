# STATE
## Session 2026-11-15 (app reloading to the launch screen): Replay plays in place, reloads are counted (claude/project-thread-oyu7yc)
- Nate: "the app keeps lagging and refreshing with the main loading screen when i do certain things". The production
  `health_counts` table was empty, so no phone data told us which action does it.
- Found: Log → Replay (`analysis_page.js` dvReplay → `ApexLogHost.load`) did `location.href = index.html?drive=…`, a full
  page load: the launch screen and the whole map rebuilt for every replay. It now plays on the map in place
  (`cockpit.js replaySaved`, like `watchDryRidge`); only a drive asked for during a live drive still falls back to the
  page load. Only the replayed saved drive is kept as a track (the load used to drop the last one). e2e flow "Replay from
  the Log plays the drive on the map in place".
- The other three paths that bring the launch screen back are now counted in app health (web/health.js and
  backend/src/health.ts METRICS, shown in Crew → App health as "reloaded: …"): `reload_gl` (the map's WebGL context lost
  for 4 s, cockpit.js), `reload_web` (iOS killed the web content process while in use, ApexNavApp.swift
  webViewWebContentProcessDidTerminate) and `reload_back` (found dead on return from the background). The shell tells
  the new page why with a `{type: 'reloaded', why}` message after it loads.
- Next: once a TestFlight build with this has run a few days, read `health_counts WHERE metric LIKE 'reload_%'`. If
  `reload_web` is high, it is memory: cut what the map page holds (the hidden Log frame, tile cache, 3D terrain) first.
  Also check why `health_counts` was empty on prod (switch default is on).
