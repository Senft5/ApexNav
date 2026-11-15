# STATE

## Members' camber on a free drive's corners ahead (Q-04, free driving, 2026-11-15)
- `contributor.js` `camberMods(track, cam, paceNoteText, may)` adds "off-camber" (slopes away, -3° or less) or "banked"
  (+3° or more) to corner notes from the camber members agree on at the apex (`camFrom`). A mapped "banked" that members
  measured leaning away is replaced, and the call is worked out again. `feelFromWays` returns `crowdCam`.
- `cockpit.js` `horizonFeel` applies it to the road ahead. Only corners not yet said and 300 m or more ahead change, so
  no call changes as it comes up. The map's curvature stays, because corners are never swapped mid-drive.
- Tests: `tests/test_contributor.py` (`camberMods`).
- e2e: "members' camber on the road ahead" drives a stub road with one right-hander that members measured sloping
  away by 6°, and checks the bend gets "off-camber" from them (`crowdCam`).
