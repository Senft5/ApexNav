# Own routing: our own scored road network, routed on the phone

The owner (2026-11-04), on why the route engine "doesn't feel too much better": today Vetta asks the public Valhalla
server for 3-8 routes and only *ranks* them, so if the best road isn't among them no scoring can find it, and planning
waits 5-7 s on a shared server. Goal: score every road in the region once, ahead of time; ship that scored network to the
phone; find the route on the phone with our own pathfinding over our own scores. Valhalla stays only as a backup and for
turn instructions until ours exist.

This page is the plan and the contract. Every builder (and any later session) works from it; keep it current.

## 1. What gets built

| Part | Where | What |
|---|---|---|
| Graph ETL | `tools/graph_etl/` (Python, pyosmium) | OSM extract -> routable graph -> per-edge features -> per-edge scores -> tiles |
| Scorer | `web/route_engine.js` run by node at build time | The SAME quality/fun/scenery model the app uses, applied once per edge (no second model) |
| Tiles | `web/data/graph/v1/` (Cincinnati, shipped in the app) + Worker/R2 or KV for the region | Binary graph tiles, see 3 |
| Phone router | `web/graph_router.js` + `web/graph_worker.js` (Web Worker) | Tile loader, bidirectional A*/Dijkstra, level-aware objective, turn restrictions, budgets |
| Planner glue | `web/cockpit.js` / route engine candidate sources | Our router is the primary candidate source; Valhalla is the fallback and the instruction source |
| CI | `.github/workflows/graph.yml` | Downloads Geofabrik extracts (the build container can't reach Geofabrik; GitHub runners can), builds tiles, uploads an artifact; with the owner's Cloudflare token, uploads the region |

## 2. The graph

- **Source:** Geofabrik `ohio`, `kentucky`, `indiana` `-latest.osm.pbf` (ODbL; attribution already in About > Sources).
  Merge, clip nothing (trips cross state lines).
- **Drivable ways:** `highway` in motorway..living_street plus `_link`, `unclassified`, `residential`, `service` (except
  `service=parking_aisle|driveway|drive-through|emergency_access` and private access), `track` only with
  `motor_vehicle=yes`. Respect `access`, `motor_vehicle`, `oneway` (incl. `-1`, `junction=roundabout`), `oneway:conditional`
  ignored (unknown stays unknown).
- **Nodes:** keep junctions (degree != 2), dead ends, barrier nodes (`barrier=gate|bollard` -> flag or cut), signals,
  stops, crossings, calming, level crossings (as edge-point features, not graph nodes).
- **Edges:** a chain of degree-2 OSM segments between kept nodes, one record per direction allowed. Geometry kept as a
  polyline (delta-encoded int microdegrees, simplified to 2 m).
- **Turn restrictions:** `type=restriction` relations (`no_*`, `only_*`), via-node only (via-way restrictions: listed,
  applied when simple). U-turns: forbidden except at dead ends.
- **Driveways and side roads:** counted from the `service` / `residential` ways that join an edge (the access-density
  features the engine already uses), even when those service ways are not themselves routable.

## 3. Features and scores per edge (the scoring contract)

Each edge carries the channels the route engine already understands (docs/ROUTE_ENGINE.md), aggregated over the edge's
length: `speed_limit_kph` (OSM `maxspeed`, else class estimate flagged), `road_class`, `road_use`, `lanes`, `divided`,
`surface`, `signals_per_km`, `stops_per_km`, `crossings_per_km`, `calming_per_km`, `access_per_km` (driveways + side
roads), `business_per_km` (shops/amenities/offices within 40 m, EXCLUDING fuel and cafes), land-use shares (from OSM
landuse/natural polygons), context-grid channels (impervious, canopy, housing, night lights, noise, AADT, IRI, crash
rate - read from `web/data/ctx/v1` / the grid the app already ships), DEM (elevation, grade, relief, ridge/valley),
geometry (curvature, corners per km by `web/fun_route.js`), crowd data (roughness, banking, flow, loved) when present.

Scores, computed by calling `web/route_engine.js` itself (node, at build time; no Python re-implementation):
- `quality` 0..1 and `scenery` 0..1 per edge (the per-25 m model, length-weighted mean over the edge).
- `fun` per edge: the gated corner score of the edge's geometry (corners only count on good road), plus the
  corner-entry context across edge joins handled at query time (a corner split across two edges must still count:
  edges keep their first/last 60 m heading so the router can score the join).
- `t_s` travel time: from the speed model the engine uses (posted/estimated speed, class, curvature, signals, stops).
- `conf` how much of the edge's weight was known (unknown stays unknown, never 0).
Time-dependent things (deer hour, school hours, weather, works, events, sun glare) are NOT baked in: they are applied at
query time from the existing providers along the chosen route and its alternatives.

## 4. Tile format (v1)

- Tiles on a fixed grid of 0.25 degrees (about 28 x 21 km here). An edge lives in the tile of its first node;
  cross-tile edges reference the neighbour tile's node id.
- One file per tile `web/data/graph/v1/<i>_<j>.vgr` (little-endian binary, gzip/brotli by the server):
  header (magic `VGR1`, version, tile i/j, counts), node table (int32 lat/lon microdegrees, first-edge index), edge
  table (to-node (tile-local or external ref), length dm, t_s ds, quality u8, scenery u8, fun u16, conf u8, flags u16
  (oneway, toll, ferry, unpaved, tunnel, bridge, motorway, ramp, roundabout, private), class u8, speed u8, name index,
  geometry offset), turn-restriction table, name table (UTF-8), geometry blob.
- `index.json`: tiles present, build date, source timestamps, model version (the route_engine.js weights hash).
- Size target: Cincinnati area (about 100 x 100 km, 16 tiles) under 15 MB uncompressed, shipped in the app. The region
  (OH+KY+IN) is downloaded by tile on demand and kept for offline areas.

### As built (2026-11-04): the exact v1 layout and what the router reads

The byte layout is in `tools/graph_etl/tiles.py` (writer, plus a reader for checks) and `web/graph_tiles.js` (the
phone's reader); tests/test_graph_tiles.py round-trips through both. What a router builder needs:

- `ApexGraphTiles.decode(arrayBuffer)` -> `{ tile, nodes: { count, lat, lon (Int32 microdegrees, multiples of 5), firstEdge (Uint32,
  count + 1: CSR), flags }, edges: { count, from, to, toTile, len_dm, t_ds, quality, scenery, fun, conf, flags, cls,
  speed, name, geomOff, hIn, hOut }, restrictions, names, geom(edgeIdx) }`; `ApexGraphTiles.load(i, j)` (memory,
  IndexedDB `vetta-graph`, then `data/graph/v1/<i>_<j>.vgr`; null when index.json doesn't list the tile);
  `tileOf(lat, lon)`, `keyOf(i, j)` = `(i << 16) | j`, `tilesIn(s, w, n, e)`.
- Storage is compact (u16 node coordinates in 5 µdeg steps from the tile corner, u16 `to` unless a tile has more than
  65 535 nodes, u16 lengths and times: the ETL splits edges at 6 km; geometry in 5 µdeg steps, its ends put exactly on
  the nodes); `decode` gives the full-width arrays above either way. Not in the graph: unnamed service roads that meet
  no public road, and unnamed dead-end service stubs under 200 m (CALL_SHEET 2026-11-04).
- **Format v2** (header version 2; `decode` reads v1 and v2): `edges.ch`, the road-side evidence per edge as
  Float32Arrays (NaN unknown), so the router can rank side streets from the tiles alone: `business_per_km` (within
  80 m, no fuel or cafes), `access_per_km` (every driveway, service and residential way joining, routable or not),
  `signals_per_km`, `stops_per_km`, `crossings_per_km`, `calming_per_km`, `schools_per_km`, `worship_per_km` (within
  150 m), all over the road's own ±500 m; `sidewalk` (the tag, else mapped footway=sidewalk lines within 15 m along
  40 % of it); `built` (the engine's built evidence 0..1: density, sidewalks, businesses, housing, impervious,
  addresses, buildings, land use); `density` (Valhalla's 0-15 from road km per km² of every vehicle way);
  `bldg_per_km`, `addr_per_km`. Stored once per polyline (both directions share it), u8 with the scales in
  `ApexGraphTiles.CHANNELS` / tiles.py `CHANNELS`. The same values already feed `quality`.
- Tile i = floor((lon + 180) / 0.25), j = floor((lat + 90) / 0.25). A node lives in the tile its position is in; an edge
  in its from-node's tile. `toTile` is the packed key of the to-node's tile (the tile's own key for a local edge) and
  `to` the node's index there. Incoming edges are not stored: build the reverse adjacency from the loaded tiles.
- Unknown stays unknown: `quality`/`scenery` 255 and `fun` 65535 are unknown (`unq8`, `funPts` give NaN); `conf` 0..255
  is the share of the engine's weight that was known.
- `quality`, `scenery`: 0..254 = 0..1, the engine's per-25 m values, mean over the edge. `fun`: gated corner points x
  100 (sum over the corners whose apex is on the edge of `fun_route.js` cornerWeight x the engine's quality gate there;
  corners are detected on the edge plus 100 m of its road's continuation each way, so a corner across a join is seen
  whole and counted once). `hIn`/`hOut`: bearing over the first/last 60 m (256ths of a turn, 0 north) for a corner made
  by a turn at a join.
- `t_ds`: the time model in score_edges.js (posted limit, else the app's class estimate, times a class flow factor;
  corners at 0.3 g lateral, braking 2.5 / accelerating 1.5 m/s²; signals, stops, crossings, calming and level crossings
  *inside* the edge). The edge's end nodes are NOT in `t_ds`: their `nodes.flags` (signal, stop, give way, barrier,
  level crossing, crossing, calming, dead end) are the router's turn cost.
- `flags` (`ApexGraphTiles.FLAGS`): oneway, toll, ferry, unpaved, tunnel, bridge, motorway, ramp, roundabout, private,
  geomRev (internal), speedEst (no posted limit), barrier (a gate inside), destination (access=destination/customers).
  `cls`: 0 motorway .. 7 service, 8 track, 9 ferry. `speed`: km/h, posted or the estimate.
- Restrictions (via node, in the via node's tile): `{ fromEdge, fromTile, via, toEdge, only }`. A via-way restriction is
  counted in index.json `stats` and not applied.
- index.json: `{ version, built, osm (replication timestamp), source, model (sha256 of the engine's weights, the corner
  weights and the time model), model_files (each scored file's hash), bbox, tiles: { "i_j": { bytes, nodes, edges,
  restrictions } }, bytes, stats }`. `CHECK.txt` beside it is the build's spot-check table.

## 5. Routing on the phone

- Runs in a Web Worker (`graph_worker.js`) so the map never stutters; tiles loaded for the corridor (an ellipse around
  start and end sized by the level's detour budget), cached in memory and IndexedDB.
- **Quick:** minimise time (A* with an admissible time heuristic: straight-line distance / max speed).
- **Fun / Max fun:** minimise `t_s * (1 + a*(1 - goodness))` where goodness blends quality, fun and scenery with the
  driver's taste; `a` is found by bisection so the route's time stays within the level's budget over the quickest
  (Quick 10 % + 60 s, Fun 35 % + 240 s, Max 90 % + 600 s, as today). Turn costs: left/right/U by angle, plus signals and
  stops on the node.
- **Alternatives:** penalty method (re-run with the chosen edges penalised) for 2 genuinely different alternates.
- **Loops:** the same objective from start back to start through a ring of waypoints, then the same scoring.
- **Final ranking:** our candidates go through the existing route engine (time-dependent penalties, weather, why line),
  so everything already built keeps working; Valhalla's quickest stays in the pool as a sanity check.
- **Turn instructions:** from Valhalla (`trace_route` on our shape) when online; offline, our own from the graph (name
  changes and turn angles). Our own instructions become primary later.
- **Fallback:** no tiles for the area, or our router fails -> today's Valhalla path, unchanged.

## 6. Proof (before it replaces anything)

- Unit tests for the parser, each feature, the scorer call, the tile codec (round trip), A* against brute-force Dijkstra
  on small graphs, turn restrictions, oneways, budgets.
- The live cases (`tests/test_route_engine_live.py`, the calibration cases) and the owner's own trips: our router's pick
  must be at least as good as today's on the engine's own value, and must never be through a subdivision or strip mall
  when a better road exists. Measured: planning time on the phone-size browser (target under 1 s for a Cincinnati trip
  once tiles are loaded), memory, tile bytes.
- A side-by-side page (both pickers on the same trips) for the owner.

## 7. What the owner has to do

- For the region beyond Cincinnati: turn on R2 in the Cloudflare dashboard (or give a Cloudflare API token as a GitHub
  secret) so CI can upload the region's tiles. Cincinnati works without it.

## 8. Status

- 2026-11-04: plan written. Geofabrik is unreachable from the build container (proxy drops the connection); the ETL is
  run in GitHub Actions and its artifact downloaded.
- 2026-11-04: the network half is built (branch claude/own-routing-graph): tile codec v1 (tools/graph_etl/tiles.py,
  web/graph_tiles.js), the ETL (tools/graph_etl, scored by web/route_engine.js through score_edges.js), CI
  (.github/workflows/graph.yml) committing web/data/graph/v1. Cincinnati tiles (CI, Geofabrik 2026-11-04): 16 tiles, 14.63 MB, 400,913 edges, 173,598 nodes, 4,225 turn
  restrictions applied (2,273 skipped: via node outside the tiles or a removed lot lane; 259 via-way not applied).
  Spot checks (web/data/graph/v1/CHECK.txt): Colerain Ave quality 0.25, Blue Rock Rd (north of I-275) 0.68, E Miami
  River Rd 0.72, Lees Creek Rd 0.58, I-275 motorway 0.82 at 109 km/h. Local e2e: one reroute flow failed under load
  (the known flake), unrelated (no page script changed).
  Not yet: the phone router (§5), the region upload (owner's R2, §7), via-way restrictions, crowd channels (no
  members' data is baked in; they stay query-time), Overpass-only channels beyond what OSM tags give directly.
- 2026-11-04 (v2): side-street evidence per edge in the tiles (`edges.ch`); 17.44 MB for the 16 tiles. Spot checks:
  Colerain Ave 0.22, Springdale Rd east of -84.62 0.32 (was 0.39), Hamilton Ave 0.21 (0.24), Pippin Rd 0.33 (0.42; the
  live engine also 0.33), Blue Rock rural 0.68, E Miami River 0.72, Lees Creek 0.58, I-275 0.82.
