# STATE

## 2026-11-14: the app calls vettadrive.app
- web/sync.js API_BASE, ApexNavApp.swift (Google sign-in and ApexApiBridge), ApexBuildNotifier, ApexCrashReports, errors.js, cameras.js and graph_tiles.js now call https://vettadrive.app; tools/csp.py CONNECT names vettadrive.app (https and wss). Google's sign-in screen now names vettadrive.app (its callback was added by Nate, checked live). CORS for apexnav://app checked live on vettadrive.app.
- tools/status_check.py, docs/STATUS.md and the uptime row watch vettadrive.app. The User-Agent contact links for OSM and the context ETL point to vettadrive.com/about.
- workers.dev stays on (wrangler.jsonc workers_dev): every build already installed calls it.

# CALL SHEET

## 2026-11-14: the API moves to vettadrive.app now, not later
- What: supersedes "the app keeps calling workers.dev for its API" (2026-11-14-domains). The domain ran fine through two deploys and a signed TestFlight build, and Google's sign-in screen showed senftns.workers.dev until the app's calls moved.
- Why: the sign-in screen and every request now carry the product's own name; sessions are bearer tokens in the Keychain, so nothing on the phone is tied to the old host.
- Undo: put apexnav.senftns.workers.dev back in the files above (tests/test_domains.py lists them) and run tools/csp.py.
