# STATE

## 2026-11-14: A map only partly kept says so
- Done: saving a map area or a route's map with a full phone or a signal that drops mid-save no longer passes the partial map off as whole. `web/offline_tiles.js put` now returns whether it kept the copy; `download` counts the tiles it couldn't fetch or keep as `missing` on the area record (`full` when the phone ran out of room) and fails when even the style can't be kept. A tile the server hasn't got (HTTP 404, the sea) is still fine. The cockpit says "only N% kept, the signal dropped / the phone is out of room" in the toast and on the area's row in Your data, and offers Update on it (in place, same id) even when the map is fresh. Tests: tests/test_offline_tiles.py (a fake IndexedDB with a room limit), e2e "offline area saved while the signal drops…".
- Next: none here.

# CALL SHEET

## 2026-11-14: A network failure counts as missing, a 404 doesn't
- What: only fetch rejects (no signal) and failed IndexedDB writes count as missing tiles; HTTP errors don't.
- Why: the tile server answers 404 for tiles it hasn't got (open sea, past the planet's edge), which is normal and was always skipped; counting those would mark most coastal areas as partial forever.
- Undo: the `catch (e)` in `download`'s tile loop.
