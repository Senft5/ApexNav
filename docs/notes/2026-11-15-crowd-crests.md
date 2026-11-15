# STATE

## "Crest" where members' phones went light (planned routes, 2026-11-15)
- `backend/src/roads.ts` (`/api/roads`): each bin now also sends `crn`, how many passes measured its crest (`crest_n`,
  column since 0006; no migration). `crest` stays their mean peak unweighting (g).
- `web/contributor.js`: `seriesFrom` keeps `crest` / `crn` per sample; `crestsFrom` makes a crest where two or more passes
  measured it and the mean is 0.15 g or more (roads.ts `CREST_G`), one per run at its lightest point (runs under 30 m
  apart are one); `measuredAlong` returns `crowdCrests`; `crestEvents` turns them into `crest` pace-note events marked
  `crowd`, none within 30 m of a crest the track has.
- `cockpit.js applyCrowdBumps`: adds them with the bumps (behind the same `crowd_bumps` flag); the route card says
  "a crest members went light over". Said with the notes awake (not in cruise): a fun-driving note.
- `web/route_feel.js`: a saved route keeps its crests for offline, like the bumps.
- Tests: `tests/test_contributor.py` (crests: two passes, one pass, a slight rise, no `crn`), `tests/test_route_feel.py`,
  `backend/test/roads.test.ts` (`crn`); e2e "a saved route keeps its road feel" checks the card, the note and Save.
- Next: free drives (the horizon) don't ask `/api/roads` yet; the same crests and bumps could reach them.
