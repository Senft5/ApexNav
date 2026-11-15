# STATE

## 2026-11-15 roam C: lower-48 OSM context, the first full run and its three failed chunks
- Run 43678591095 (04:52 UTC) built 147 of 150 chunks; 34_-92, 35_-92 and 36_-92 (Tennessee, Arkansas, the Carolinas' west) stopped on osmium extract's "Relation ID twice in input": two states' extracts carried a border relation in two versions. The band merge now keeps every version (`osmium merge -H`) and `osmium time-filter` keeps the newest.
- New dispatch inputs: `bands` (only these chunks of the plan, each with all its states) and `osm_from` (build from an earlier run's osm-* artifacts, 2 days, skipping Geofabrik). Rebuild of the three: dispatch on main with bands=34_-92,35_-92,36_-92 osm_from=43678591095.
- Next: after that run, check a Smokies cell on prod (/api/ctx/points?cells=142_-335).

# CALL SHEET

## 2026-11-15 roam C: newest version wins when states' extracts disagree
- What: osm-ctx-us.yml band step merges with -H, then time-filter (now).
- Why: Geofabrik cuts states separately; a day's difference at a border stopped three chunks.
- Undo: back to the plain `osmium merge` line.
