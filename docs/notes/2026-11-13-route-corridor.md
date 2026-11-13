# STATE

## 2026-11-13: The drive page asks for a saved route's map only for a drive that kept to the route
- Done: a route's offline area now keeps its line thinned to 100 m (`ApexOfflineTiles.lineOf`, `line` + `lineTolKm` on the record); with no signal, `ApexDriveBasemap.covered` takes the drive's points and asks for that map only when every point (about 400 looked at) is within the corridor less the thinning. A drive that cut across inside the route's box gets the blank, said panel instead of blank tiles. Older areas with no line keep the box check.
- Next: a saved route's area made before this keeps the box until it is saved or updated again.

# CALL SHEET

## 2026-11-13: A 100 m thinned line on the area record
- What: Douglas-Peucker to 100 m, kept in localStorage `apex.offlineAreas` beside the box; the check subtracts the 100 m from the corridor.
- Why: the saved route's own coords live in another store and may be removed or re-saved; a few hundred points (a few KB) keep the check self-contained.
- Undo: drop `line` from `download` in `web/offline_tiles.js`; `covered` falls back to the box.
