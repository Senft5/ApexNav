# STATE
## Session 2026-11-14 (OSM relay on): the phone asks the relay first (claude/roam-c-osm-relay-on)
- The `osm_relay` flag now defaults on (backend/src/flags.ts). The relay answers from the weekly Geofabrik build (#799, R2 `osm/v1/`) and asks Overpass only for a border tile, so a plan's road details (limits, signals, signs, guard rails, viewpoints, fuel, routes) arrive on the plan's clock again.
- Next: watch `osm_relay` in the service check and the relay's `x-cache: built` share; a dense downtown tile is about 2.8 MB of JSON (Cloudflare compresses it on the wire), the same as the phone's own Overpass answer was.

# CALL SHEET
## 2026-11-14 (OSM relay on): the phone uses our relay by default (claude/roam-c-osm-relay-on)
Every public Overpass mirror timed out or refused from 11-12, so the plan had no OSM road details. The built tiles make the relay dependable. The phone payload is unchanged from a direct Overpass answer (at most 12 tiles a plan). Undo: FLAGS {"osm_relay":{"on":false}} on the Worker, or set `on: false` in flags.ts.
