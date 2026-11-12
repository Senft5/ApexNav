# STATE

## 2026-11-12 Service check: first results, and two small fixes (claude/project-thread-9zycz2)
- First run (Nate's website, 02:45 UTC): the three main Overpass servers timed out at 15 s and maps.mail.ru took 11 s,
  so the app's camera path read "Camera map offline"; our camera list (/api/cameras/v1/region.json, 11,969 cameras)
  answered in 0.46 s. Fun, Long way and loop plans were all up on the web. No iOS run yet.
- web/service_check.js: the OSM relay's 504 still_fetching reads as slow ("up, but still fetching from Overpass"), not
  down; the graph indexes show their build date, since the long build id was scrubbed to "[token]" on the server.
- Next: read the first iOS run (after the next TestFlight build) for the "check signal" error on Fun / Long way.
