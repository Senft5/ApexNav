# STATE

## 2026-11-13: Saved offline areas say how old they are, and update in place
- Done: each row in Settings → Your data says "saved Mar 2026" (`ApexOfflineTiles.ageOf`); an area saved 180 days ago or more offers Update, which downloads the same place, size and name again under the same id, members' road feel included (`saveAreaAt` in `web/cockpit.js`, shared with Save the map here). A record with no date stays unknown and is never offered as old.
- Next: route areas ("along the route") are refreshed by saving the route again; an Update for them could re-run `keepMapAlong` from the saved route.

# CALL SHEET

## 2026-11-13: Half a year before an area offers Update
- What: `STALE_DAYS = 180` in `web/offline_tiles.js`; only areas older than that get an Update button.
- Why: map data changes slowly; a button on every row would add clutter (the owner's 2026-11-12 UX rule), and an old map still draws.
- Undo: raise `STALE_DAYS`, or drop the `age.stale` branch in `renderAreas`.
