# STATE
## Session 2026-11-14 (places built): a place card's hours, Call and Website from our weekly build (claude/roam-c-places-built)
- A place card (tap, Find nearby, the Along list) asked public Overpass for the place's opening_hours, phone and website, failing on nearly every check from 11-12. tools/osm_ctx/region.py now also writes `osm/v2/places/<bi>_<bj>.json` per covered 0.25° cell (named places with PKEYS, only those tags; an empty cell as `[]`); `GET /api/ctx/places?p=lat,lon,name` (up to 10) matches by name within ~150 m as place_info.js match() did, 404 when a cell isn't built; place_info.js asks it first, Overpass on anything else.
- The states' .poly outlines are kept in tools/osm_ctx/polys/ (Geofabrik, ODbL): the workflow fetches fresh ones and uses the kept copy when Geofabrik refuses, as it did every connection for a while on 2026-11-14.
- Next: after merge, run osm-ctx.yml on main and try a Cincinnati café on /api/ctx/places.

# CALL SHEET
## 2026-11-14 (places built): place lookups go to our server first (claude/roam-c-places-built)
Our server sees the place's name and position, as Overpass did, and keeps nothing; the privacy page and APP_REVIEW say so. One file per cell keeps each lookup to a few small R2 reads. Undo: drop `ours()` from web/place_info.js.
