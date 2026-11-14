# STATE
## Session 2026-11-14 (shared road data): way geometry from our weekly build (claude/roam-c-contrib-ways)
- web/contributor.js bins a drive's road data along each matched OSM way from its first node, and it fetched those ways' geometry from overpass-api.de alone, with no fallback. That server mostly refuses since 2026-11-12, so live and Log contributions (and the crowd's measured-along for a plan) failed with "way lookup failed".
- `GET /api/ctx/ways?tiles=&ids=` (osm_relay.ts wayShapes; up to 40 0.05° tiles and 200 ids) reads the built tiles (builtTile) and returns {ways: {id: [[lat, lon], ...]}}. The ways are whole, because osm-ctx.yml extracts with `-s smart`. A way in no built tile is left out.
- contributor.js `fetchWays(ids, fetch, { drive, match })` asks ours first (through ApexSync.apiFetch; `wayTiles` gives the tiles of the matched samples). Only leftovers go to Overpass. All four call sites pass the drive and match.
- Privacy page and APP_REVIEW updated: our server gets the way ids (which the contribution already carries) and the tiles they are in.
- Not changed: map matching itself still uses the public Valhalla server (valhalla1.openstreetmap.de); the routing thread owns it.

# CALL SHEET
## 2026-11-14 (shared road data): geometry from the built tiles by tile and id, not a way-id index (claude/roam-c-contrib-ways)
The phone knows which tiles its matched samples are in, so the server can read the tiles it already has (two ranged R2 reads each) instead of building and storing a separate index of every way's shape. Coordinates are 6 decimals against Overpass's 7, a few centimetres, which doesn't change a 5 m bin. Undo: pass no `near` to fetchWays.
