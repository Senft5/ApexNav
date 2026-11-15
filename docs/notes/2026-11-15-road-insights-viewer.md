# STATE
## Session 2026-11-15 (road insights viewer): data.vettadrive.com viewer + keyed API (claude/project-thread-26f4xi)
- Done: web/insights.html + insights.js (map viewer; made-up sample web/insights-sample.geojson until a key is pasted), backend/src/road_insights.ts (GET /api/data/v1/roads.geojson with a key, /api/data/v1/meta public), data.vettadrive.com custom domain (wrangler.jsonc, hosts.ts DATA_HOST), road_floor counts up to 50 distinct holders, tools/data_key.py, road_data_partners flag (off). No migration.
- Next: the data.vettadrive.com custom domain is created by the next deploy; check it answers. Real roads show only where 10+ established drivers drove, so expect none for now. Then per-section figures and IRI calibration (docs/ROAD_INSIGHTS.md §6).

# CALL SHEET
## 2026-11-15 (road insights viewer): count distinct drivers by raising road_floor's cap instead of a new table
road_floor already held hmac holders per road+direction for the two-driver rule; raising its cap from 2 to 50 gives the ten-driver floor and the noise scale with no migration and no new kind of data. Drivers before today count again on their next drive, so the count starts low (stricter, not looser). Undo: set FLOOR_CAP back to 2 in roads.ts (the API then releases nothing).
## 2026-11-15 (road insights viewer): the public viewer shows a made-up sample, never real data
Nothing is public until the sold-data opt-in and policy text exist (ROAD_INSIGHTS.md §4). The sample uses real OSM road lines with values made up, labelled as made up in the page, the file and the meta. Partner keys stay refused until the owner turns road_data_partners on. Undo: delete web/insights-sample.geojson and the viewer falls back to an empty map.
