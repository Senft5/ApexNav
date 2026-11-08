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
- `t_s` travel time: from the speed model the engine uses (posted/estimated speed, class, curvature, and the signals,
  stops and crossings inside the edge). Not those on its end nodes: they are node flags and the router adds them at
  query time with the same seconds (§5, §8), so each is counted once.
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
- **Format v3** adds the via-way restriction table (`restrictionsVia: [{ from, fromTile, via: [edges], viaTiles, to,
  toTile, only }]`, every index in its own tile, keys packed); readers open v1, v2 and v3. A via-way restriction whose
  via way isn't drivable (a motorway's emergency crossover) is counted in `stats`, nothing to apply.
- **The shipped set is the region build's** (tools/graph_etl/bundle.py after every region build), so it is used first.
- **The context grid region-wide**: tools/ctx_etl `--preset region` in six shards (ctx-region.yml) on graph-data
  `ctx/v1/`, served by /api/ctx/v1/ (KV first, then the branch); the graph's band jobs score with it when present.
- **Where tiles come from** (`ApexGraphTiles.load`): memory, IndexedDB, then the shipped Cincinnati tiles
  (data/graph/v1) or the region's (`<api>/api/graph/v1/`); `index()` is the union of both indexes (the region's asked
  once a day, kept for offline). Every tile has a `build` id (the extract's week + the model hash) and the shipped copy is
  used first only while the region holds the same build: a tile's edges into a neighbour index the neighbour's nodes as
  their build numbered them, so a route never mixes two builds across a tile edge. `prefetchArea(bbox)` keeps an area's
  tiles in IndexedDB; Save area (web/offline_tiles.js) calls it.
- index.json: `{ version, build, tile_count, built, osm (replication timestamp), source, model (sha256 of the engine's weights, the corner
  weights and the time model), model_files (each scored file's hash), bbox, tiles: { "i_j": { bytes, nodes, edges,
  restrictions } }, bytes, stats }`. `CHECK.txt` beside it is the build's spot-check table.

## 5. Routing on the phone

- Runs in a Web Worker (`graph_worker.js`) so the map never stutters; tiles loaded for the corridor (an ellipse around
  start and end sized by the level's detour budget), cached in memory and IndexedDB.
- **The levels** (the owner, 2026-11-08: "fun should never go on the highway. Quick should essentially be a normal
  route"): Quick is the quickest way as any nav app drives it, highways welcome, a nicer road only inside a minute (budget
  0 + 60 s). Fun and Long way never drive a motorway, a trunk road or their links (`cls` 0-1, or the `motorway` flag;
  `K.NO_HWY`): a hard filter in the search (`opts.ban`), not a cost, in the plan, its first route (`quickest`), every
  alternate, `through` (a reroute of a route planned there) and every loop leg. A point snapped onto a highway moves to the
  nearest other road within 150 m (`snapOff`; a moving car within 25 m of one stays on it). The exception, only where no
  way without one exists in the level's corridor (a river crossed only by an interstate bridge, a start or end on a ramp):
  each highway second x25 (`hwyX`), so the link is the shortest there is; the routes carry `hwyKm`, `hwyName` and
  `hwyReason` ('across', 'start', 'end') and the card says "Uses 0.4 mi of I-275 (no other way across)". A highway-free way
  over 2x the quickest's time is still the level's way, alone (no bisection), `hwy.absurd`; the card: "No highway-free way
  in a sensible time; Quick is the way". The highway quickest stays in the pool as Quick's card and the level's measure;
  the budget never shuts out the highway-free quickest (+ 60 s). `plan()` returns `hwy: { mode: 'any' | 'free' | 'link',
  absurd, quickS, freeS }`. The ranking keeps the same rule (ROUTE_ENGINE.md, fun_route.js `applyHighways`). Not in the
  tiles: an expressway mapped as `primary` with `motorroad=yes` (the ETL doesn't keep the tag yet; a tile rebuild would).
- **Quick:** minimise time (A* with an admissible time heuristic: straight-line distance / max speed).
- **Fun / Max fun:** minimise `t_s * (1 + a*(1 - goodness))` where goodness blends quality, fun and scenery with the
  driver's taste; `a` is found by bisection so the route's time stays within the level's budget over the quickest
  (Quick 60 s, Fun 35 % + 240 s, Max 90 % + 600 s; at Fun and Long way the search is the highway-free one above). Turn costs: left/right/U by angle, plus signals and
  stops on the node.
- **Alternatives:** penalty method (re-run with the chosen edges penalised) for 2 genuinely different alternates.
- **Loops:** any route from the start back to it with little driven twice, built from the best roads within reach (the
  owner, 2026-11-06: not a circle): the tiles' best stages (explore) chained one to three at a time, each leg on the
  level's objective with motorway and trunk costed x2.5 at Quick and never driven at Fun and Long way (2026-11-08: a
  leg whose start leaves only a highway ahead turns round first, `loopLeg`; else the exception's shortest link); rings
  only where no stage loop exists; a loop on a highway never ranks above one off them at Fun and Long way (loopRank). Then the same scoring, which charges a loop's highway share (fun_route.js loopHighwayCost) and never puts
  a loop above one that beats it on corners and time (loopDominates). Ours go up first; the map's stage loops (Valhalla's
  matrix and legs) are built after the card and replace ours only when the level ranks one of them first (2026-11-07).
- **Final ranking:** our candidates go through the existing route engine (time-dependent penalties, weather, why line),
  so everything already built keeps working; Valhalla's quickest stays in the pool as a sanity check.
- **Turn instructions:** ours from the graph (name changes and turn angles) go up with the route; Valhalla's
  (`trace_route` on our shape) replace them on the track when they come, never waited for; offline ours stay.
- **Posted limits** (the limit sign, the strip, the ETA's envelope where a route has no router time): on our routes from
  the tiles the route was planned on (each edge's `speed`, not when flagged `speed_est`, a class estimate; route.graph
  `limit` by metres along the line), each 5 m sample matched to the line in order (own_routing.js `limitsAlong`, in a
  task after the card; 2026-11-08). An edge with no posted limit is null, an unposted road, as map matching says it.
  Valhalla's `trace_attributes` only for lines off our tiles (a GPX file, a route Valhalla planned, a saved route).
- **Points routed** (a reroute, a road from Best roads nearby, a suggestion, a road someone sent, Drive it again, a link's
  or GPX file's stops): `through`, the quickest between the points on our tiles, each leg joined where the last arrived
  (2026-11-07); Valhalla only where a point is off our tiles or ours fail. The traffic detour stays on Valhalla.
- **Offline:** with the app and its tiles on the phone (the shipped Cincinnati tiles, and every region tile a plan or a
  saved area fetched, kept in IndexedDB), routes at every level, loops, reroutes and our own turn instructions need no
  network, and nor do the posted limits on them (below); typed search, the map's basemap (unless the area was saved),
  weather, events, live hazards and Valhalla's maneuvers (lanes, exits) don't, and the card says the live data isn't
  known.
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

- Nothing. The region's tiles (OH+KY+IN) live on this repository's `graph-data` branch, built by
  .github/workflows/graph-region.yml, and the Worker relays them at `/api/graph/v1/` (backend/src/graph.ts) from
  raw.githubusercontent.com with the edge cache in front: free, no R2, no KV, no secrets (2026-11-04, the owner: free
  tier, no new costs).

## 8. Status

- 2026-11-04: plan written. Geofabrik is unreachable from the build container (proxy drops the connection); the ETL is
  run in GitHub Actions and its artifact downloaded.
- 2026-11-04: the phone's router built (branch `claude/own-routing-router`, merged with the codec branch):
  - `web/graph_router.js` (pure, node-tested): the loaded tiles as one flat graph, cross-tile edges stitched by the
    tiles' packed keys; edge-based A* (the state is the edge you arrived on, so restrictions, U-turns and turn costs are
    exact), heuristic straight-line distance over the network's top speed times the objective's smallest per-second
    cost (admissible at every `a`). Snapping to the nearest edge and its other direction, part-way along.
  - Costs: edge `t_s`; turns by angle (right 2-10 s, left 5-21 s, U 30 s), only at junctions or bends over 70°;
    U-turns back the way you came only at dead ends; end-node flags signal 15 s, stop 7 s, give way 2 s, level
    crossing 4 s, calming 3 s, crossing 1 s (build.py DELAY_S), barrier 120 s; private and barrier edges x10 + 600 s, destination-only x2 + 60 s, unpaved x1.5,
    ferry x2; Avoid chips multiply (highways x4, tolls x3, ferries x5, unpaved x5).
  - Goodness per edge: 0.5 quality + 0.3 fun (gated corner points per km against the loaded network's 90th
    percentile) + 0.2 scenery (half-counted below the corner gate), the corner prefs scaling fun; unknown channels drop
    out, and the whole blends to 0.3 by how little was known (`conf`), so unknown road can't win.
  - Plans: the quickest, then `a` bisected in log steps (at most 5 more searches) for the largest `a` whose time is
    inside the level's budget (fun_route.js LEVELS, the same numbers); every distinct route found inside the budget is
    a candidate. Two alternates by the penalty method (x1.6, x2.5, x5 on the chosen edges) that differ by 30 % of
    their length and stay inside the budget. At most 5 routes go to the route engine.
  - Loops: 4 rings through the start (radius from the length / 2π / 1.35), 3 waypoints each snapped to through roads,
    each leg on a fixed `a` (Quick 0.6, Fun 3, Max 8) with earlier legs' edges x3; they join the loop planner's pool.
    (Replaced 2026-11-06 by loops from the best roads; see the end of this section.)
  - Output per route: `coords` [[lat, lon]] at the edges' geometry, `edges` ("i_j:local" ids), `timeS`, `distM`,
    `names` per stretch, `why` (quality, scenery, fun, conf, a, role, signals, junctions) and `route` in the shape of
    cockpit.js routeOf (coords [[lon, lat]], turns, times, steps as Valhalla maneuver types, names, has), so corridors,
    the context run, the ranking and the why line take it unchanged.
  - `web/graph_worker.js` hosts it (messages covers / plan / loop by id); `web/own_routing.js` is the planner's side.
  - Planner glue (cockpit.js funRoute, buildLoop): where index.json covers start and end, our routes are the
    candidates, the stage plans, matrix and highway-costed call are skipped, and Valhalla's quickest stays in the pool
    as a check (waited for at most 2.5 s once ours are in). The chosen route gets Valhalla's maneuvers from one
    `trace_route` (map_snap, our line as encoded_polyline, 3 s), else our own. Ours are always pinned with shaping
    points so a Valhalla reroute keeps to them. Not covered, flag off, or any failure: today's path, unchanged.
  - Flag `own_routing` (backend/src/flags.ts), on; it only acts where tiles exist. Off for everyone:
    FLAGS {"own_routing":{"on":false}}; one phone: localStorage `apex.ownRouting` = "0".
  - Measured (node, 16-tile synthetic network of 179k edges): one search 2-90 ms, a whole Fun plan 90-550 ms, the
    graph view built in about 100 ms. tests/test_graph_router.py; e2e: two flows in e2e/smoke.js.
  - Not yet: the live comparison with production on the 7 cases (no real Cincinnati tiles exist yet); Explore still
    uses Valhalla; corner entry across edge joins (hIn/hOut) is read for turn angles only, not yet scored as fun.
- 2026-11-04 (later): the router on the real Cincinnati tiles (16 tiles, 14.6 MB), live against production:
  - **Fixed, from the live run:** (1) `t x (1 + a x bad)` could never buy more time than the ratio of two roads'
    badness (0.68 vs 0.74 here: any detour over 9 % lost at every `a`), so Fun and Max came back as the quickest. The
    objective is now `t x exp(a x bad)` (same heuristic argument: exp(a x min bad) >= 1), `a` bisected in [0, 40].
    (2) Goodness was quality-led, and the motorway has the network's best quality, so a large `a` pulled toward I-275:
    goodness is now 0.2 not-a-side-street (quality 0.25-0.45, the engine's poor cost) + 0.15 quality + 0.45 corners
    (per km against the network's median) + 0.2 scenery. (3) Our clock ran 12 % slow against Valhalla's on the same
    roads, so at Quick our copy of the router's route lost to it on time alone: where Valhalla's route (default or
    highway-friendly, both asked as checks) is the same way as our quickest, ours go on its clock (oneClock, 0.75-1.33).
    (4) Route names in km, as routeOf has them. (5) Every bisection step goes to the engine (up to 7 routes).
  - **Members' data in the search:** at plan time the corridor's `/api/roads?cells=` (0.1° cells, VI-1, at most 16, 1.5
    s) is fetched alongside the coverage check; the tiles hold no OSM way ids, so each way's line is walked every 10 m in
    its measured direction onto the nearest same-heading edge within 15 m (crowdOnto). Each measured edge's quality takes
    roughness and flow, its scenery loved and banking, with the engine's own weights (rough 1, flow 1, loved 1.5,
    camber 0.5) against the model weight the tile already knew (conf x 37.1 quality, 12.8 scenery). Signed out or no
    data: unchanged. Test: a loved, smooth lane wins a 2 s near-tie in the search.
  - **Gap:** via-way turn restrictions (259 in Cincinnati) are counted by the ETL and not in the tiles, so the router
    can't apply them; the tile format needs a via-way table (from-edge, via edges, to-edge) first.
  - **Live, 2026-11-04** (scratchpad live2/run_own.js on a local serve; production's pick scored by the same engine in
    the same pool; values in engine points, higher is better):

    | case | our pick (km) | vs quickest | ours | prod | plan / first route |
    |---|---|---|---|---|---|
    | owner1 quick | Blue Rock 6.4, Dry Ridge 3.7, Cheviot 1.9, Weik 1.0 | +1.1 min | -32.5 | -66.6 | 6.0 / 1.7 s |
    | owner1 fun | Blue Rock 4.3, Dry Ridge 3.7, Jessup 3.6, Sheed 2.4 | +2.5 min | -24.1 | -33.0 | 6.9 / 1.8 s |
    | owner1 max | Sheed 4.5, Thompson 4.3, Dry Ridge 3.7, Jessup 3.6 | +13.8 min | -1.6 | -30.6 | 7.3 / 1.9 s |
    | subdivision fun | Pippin 2.4, Redharvest 0.4 (the same as prod) | 0 | -34.2 | -34.2 | 3.3 / 1.1 s |
    | subdivision4 fun | Pippin, Miles, Hamilton, Struble (the same roads as prod) | +3.1 min | -55.5 | -53.8 | 4.3 / 1.6 s |
    | northgate fun | Mill Road 3.3 | +1.4 min | -25.6 | -42.8 | 6.3 / 2.5 s |
    | colerain quick | Cross County Hwy 6.0, Blue Rock 4.0, E Miami River 1.7 | +0.7 min | -5.1 | over budget | 5.3 / 1.7 s |
    | colerain fun | the same, Weik and Dry Ridge | +0.7 min | -0.4 | -40.1 | 4.9 / 1.7 s |
    | colerain max | the same, a longer way in | +1.5 min | 2.9 | -36.1 | 5.8 / 1.6 s |
    | harrison fun | Cincinnati Brookville 6.3, California 4.0, Alert-New London 3.3 | +8.2 min | 30.3 | 13.6 | 7.3 / 1.8 s |

    Our router produced every winner. subdivision4 is the same route as production's; the 1.7 points are the hour's
    deer and low-sun penalties (the two captures were made at different times). Strip mall at most 0.6 km on any pick
    (production up to 1.7 km). Tiles per plan 2-6 (3.6-8.5 MB); the router's own time 0.1-1.5 s in the browser.
    Plan times are still the route context's 4 s budget (unchanged; the router is not the long pole).
- 2026-11-05: faster planning with our tiles (merged main through #297, the planning flow):
  - **First route:** our quickest alone (one search, the worker's `quick`) goes up the moment it lands; Valhalla's
    answers are checks and its trace_route maneuvers replace ours on the track when they come (nothing waits for them).
    The plan keeps that same candidate when it is the plan's quickest, so the card says "Checked N routes" rather than
    "Better route found" for an unchanged route.
  - **Ranking:** own-routed plans run only `graph` (new, route_ctx/graph.js: the tiles' quality and scenery on any
    corridor by the nearest same-heading edge), `context_grid` (local bundles), conditions, wildlife, events,
    hazards-live and driver, in 0.9 s, at once (no first-route gate). route_engine.js fills a sample's quality and
    scenery from the tiles where its live channels know under 30 % of the model's weight, and keeps the lower of the
    two where it knows some (an edge mean can smooth over a built-up stretch). Valhalla's checks join only if they are in
    150 ms after our context; geometry and forecasts are prepared while the context runs.
  - **Warm tiles:** the tiles within 15 km of you load into the worker 1.5 s after start (bundled files, then IndexedDB)
    and again after 10 km; one view is kept and grown (up to 20 tiles), so a plan nearby builds nothing.
  - **Live, 10 runs** (first route / ranked route built, ms; warm = the second plan in the session; values on the SAME
    full context for both picks, scratchpad live2/judge.js):

    | case | cold first | warm first | warm ranked | ours | prod |
    |---|---|---|---|---|---|
    | owner1 quick | 421 | 840 | 1699 | -48.4 | -66.5 |
    | owner1 fun | 641 | 863 | 1199 | -25.2 | -35.6 |
    | owner1 max | 570 | 1053 | 1588 | -21.5 | -34.1 |
    | subdivision fun | 349 | 481 | 1604 | -44.6 | -34.2 |
    | subdivision4 fun | 411 | 659 | 1293 | -52.7 | -53.3 |
    | northgate fun | 457 | 766 | 1635 | -41.1 | -41.0 (same route) |
    | colerain fun | 536 | 865 | 1834 | -7.0 | -40.1 |
    | harrison fun | 481 | 956 | 1565 | 23.9 | 12.2 |
    | colerain quick | 590 | 993 | 1533 | -9.3 | over budget |
    | colerain max | 1313 | 945 | 1547 | -7.0 | -36.1 |

    Picks changed against the full-context round in 5 runs (owner1 quick and max, harrison, colerain fun and max): the
    ranking now sees the tiles' edge scores instead of the live per-25 m channels (no business cost, no OSM points such
    as schools or crossings). On the same full data 9 of 10 are at least as good as production; **subdivision fun is
    worse** (Pippin, Springdale, Struble +3.6 min, -44.6 against -34.2): the tiles score Springdale Road and Hamilton
    Avenue higher than the live model does, because the build has no router density, sidewalks or driveways (the
    router's own edges). Fix in the ETL: those channels, or a per-edge share of side-street samples, baked in.
  - Not met: the ranked route under 1.5 s warm (1.2-1.8 s; the time-dependent context is 0.15-0.9 s of it, building the
    track 0.05-0.3 s, the rest the pool's preparation).
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
- 2026-11-05 (later): v2 tiles (17.4 MB, road channels per edge) and the plan profiled:
  - route_ctx/graph.js passes the v2 channels under the engine's own names (business, access, signals, stops,
    crossings, calming per km, sidewalk, density, buildings, addresses), so the ranking from tiles reads side streets,
    density and businesses as the live model does; the subdivision pick is now production's route.
  - Where the warm plan's time went, and the fixes: a fresh fix asked for again (0.2-0.5 s: a fix under 10 s old is
    used); a timer per candidate and per check waiting behind the map's work (yield only after 40 ms; checks only when
    already in); the per-edge objective rebuilt per request over 400k edges (cached per view); the A* flooding the
    preloaded area at large `a` (bounded by the corridor ellipse: plans 340-1070 ms -> about 110 ms); the plan message
    (nested coordinate arrays: now one Float64Array per route, coords built when read); corridors, scoring and
    Valhalla's checks started alongside the first draw (now after the frame that shows it); the early route's land cover
    decoded on the page (not asked for the early route); the ranked route's land cover waited up to 4 s (400 ms, then
    the cautious 4 m; the tiles land in the cache); the context 600 ms.
  - **Live, 10 runs, v2 tiles** (ms from Enter as the page gets it; cold = the session's first plan with the tiles
    preloaded, warm = the second; values on the same full context for both picks):

    | case | cold first / ranked | warm first / ranked | ours | prod |
    |---|---|---|---|---|
    | owner1 quick | 983 / 2532 | 434 / 907 | -26.0 | -64.8 |
    | owner1 fun | 386 / 1989 | 453 / 1029 | -20.3 | -32.6 |
    | owner1 max | 471 / 2199 | 373 / 1081 | -13.6 | -29.8 |
    | subdivision fun | 269 / 1775 | 289 / 875 | -34.0 | -34.2 |
    | subdivision4 fun | 281 / 1448 | 332 / 813 | -49.6 | -50.1 |
    | northgate fun | 629 / 2082 | 451 / 1065 | -35.8 | -37.8 |
    | colerain fun | 394 / 1920 | 463 / 1115 | -7.0 | -38.4 |
    | harrison fun | 519 / 2498 | 479 / 1483 | 16.3 | 10.2 |
    | colerain quick | 788 / 2107 | 548 / 1261 | -7.0 | over budget |
    | colerain max | 501 / 1741 | 464 / 1022 | -4.4 | -34.2 |

    Every pick at least as good as production's; warm ranked 0.8-1.5 s. Not met: the warm first route is still 20-70 ms
    slower than cold in 4 runs (the worker answers the first question 70-90 ms after Enter in a warm session, 5-100 ms
    cold; not found yet).
- 2026-11-04 (region): OH+KY+IN built by .github/workflows/graph-region.yml (6 bands in parallel, 1 h 42 min) and
  committed to the `graph-data` branch (ba6787a): 584 tiles, 228.9 MB (largest 4.5 MB), 5.26 M edges, 2.15 M nodes,
  build 2026-45-95960e6d; 1,211 via-way restrictions applied (1,504 through undrivable crossovers). The preview Worker
  serves them (/api/graph/v1/388_519.vgr, Columbus: 2.9 MB, decodes, 69,058 edges). Not yet: the Cache API is a no-op
  on workers.dev, so each tile request goes to raw GitHub until the Worker has a custom domain; the context grid
  covers only Cincinnati, so outside it those channels are unknown; the shipped Cincinnati tiles are an older build
  than the region's, so the phone uses the region's there until both are rebuilt together.
- 2026-11-05 (night): the speed round (branch claude/own-routing-fast):
  - The card is final on the tile ranking with the time-dependent context as cached for the area (the forecast not
    waited for); the fresh context (weather, events, works, deer) re-ranks afterwards and swaps the route only for a
    gain of 5 points, the card saying "Weather ahead: switched to ..." (cockpit.js ownRefine).
  - The first route comes from the tiles under the straight line only (a small view of its own); the preload loads
    one tile at a time, nearest first, and waits while a plan is answered; tiles are served as text so the edge
    compresses them (brotli); coverage is read on the page from index.json.
  - Best roads nearby from our tiles (graph_router.js explore: quality x corners chained into stages, timed by one
    search); via-way restrictions applied in the search (v3 tiles' restrictionsVia).
  - Best roads nearby is never a neighbourhood (2026-11-04): no neighbourhood-street edge (`streetEdge`: residential class
    in built-up frontage, fun_route.js `streetSample`) or destination-only edge makes a stage, and a stage's dead-end end is
    cut back to the last junction unless that run is 2 km or more of good road (`OUT_BACK_KM`, an out-and-back road). ROUTING.md "Explore" has the rule and the checks.
  - Preview, 10 runs (ms from Enter; first route drawn / final card; cold = a fresh profile's first plan):

    | case | cold | warm | ours | prod |
    |---|---|---|---|---|
    | owner1 quick | 839 / 2318 | 494 / 1096 | -26.0 | -64.8 |
    | owner1 fun | 989 / 2312 | 459 / 1101 | -20.3 | -32.6 |
    | owner1 max | 437 / 2623 | 673 / 2263 | -13.6 | -29.8 |
    | subdivision fun | 587 / 2340 | 286 / 989 | -34.1 | -34.3 |
    | subdivision4 fun | 411 / 1822 | 314 / 932 | -49.6 | -50.1 |
    | northgate fun | 682 / 3286 | 753 / 1993 | -37.0 | -39.0 |
    | colerain fun | 657 / 2426 | 552 / 1425 | -8.9 | -40.2 |
    | harrison fun | 478 / 4824 | 1002 / 2911 | 20.0 | 13.7 |
    | colerain quick | 614 / 2509 | 723 / 1695 | -8.9 | over budget |
    | colerain max | 343 / 3011 | 498 / 1298 | -4.5 | -34.2 |

    Cold first route under 1 s in all 10; every pick at least as good as production's. Not met: the final card under
    1 s warm (5 of 10) and under 1.5 s cold (0 of 10): the preload (17 MB, 5-6 s on this network) still loads during
    the first plans, and the context and track build wait on the page behind it.
- 2026-11-06 (later): destination picks (branch claude/dest-picks): the objective's corner term keeps
  `ApexFunRoute.builtKeep` of each edge's fun, from the built evidence two of the v2 tiles' road channels agree on
  (`builtAgreeOf`, the engine's own readings), so the search no longer chases corners on streets lined with houses; and
  after the bisection the plan tries `K.LOWER` (0.9, 0.75) of the weight found, so cheaper ways to the same good road
  reach the ranking (live, a cross-suburb trip at Fun: the 29-minute way to a county road was missing, only a
  31-minute I-275 loop came back). Plan time: two more searches, 50-200 ms on the 16 tiles in node.
- 2026-11-06: loops off the highway, from the best roads (branch claude/loops-off-highway; CALL_SHEET 2026-11-06):
  - The owner: "it also seems to route mostly highway for loops". Live on production, the winner was 80-93 % motorway or
    trunk in 4 of 14 cases (Sharon Woods 1 h Fun 80 %, 1 h Long way 90 %; Fountain Square 30 mi Fun 93 %, 1 h Long way
    89 %), and 56 % in two more (stage plans). The causes: (1) our ring legs had no highway cost, and the objective
    reads a motorway as good road (quality 0.82), fast; (2) Valhalla's stage legs asked `use_highways` 0.6
    (connectorCosting, "highways welcome"); (3) the ranking had no highway term, and the engine's quality and side-street
    terms favour a motorway (no driveways, no businesses), so a highway loop outscored back roads by 50-100 points;
    (4) removeSpurs looked 400 points ahead, the whole of a sparse own-routed loop, so some came out 0 km and won.
  - graph_router.js `loop`: explore's stages within reach (a loop's half length at 15 m/s), at most 8, chained as
    singles, pairs and (25 km and up) triples, each way round; the length guessed as the stages plus 1.7 x each
    connector's crow line; the 6 best by stage score x length fit routed through a point every 1.5 km along each stage
    (snapped to the stage's road and heading), legs with motorway/trunk x LOOP_HWY_X and earlier legs x3; over 40 %
    driven twice dropped; loops more than 60 % off the length dropped. `hwyShare` per loop.
  - Planner: loop legs and the loop matrix on `loopCosting` (use_highways 0.25 Quick, 0.1 Fun / Long way); the circle
    only when nothing else was built; the ranking is `FunRoute.loopRank` (Fun score + level adjustment - highway cost,
    then dominance); `apexDebug.lastLoop` lists every loop with its kind, value, highway share, corners, time and pick.
  - Live before and after (the real app in Playwright, production's Worker; table in STATE.md 2026-11-06).

- 2026-11-07: instant and offline; Valhalla only as backup (branch claude/own-routing-instant; CALL_SHEET 2026-11-07):
  - **Timeline per plan:** `apexDebug.timeline` ([what, start, end] ms from the plan's start): the worker's quickest
    and plan, members' roads, each context provider, the Valhalla checks and instructions, towns, ranking, each track
    build (yield, resample, the analysis worker, corners) and each draw with its card; `lastOwn` adds viewMs, geoMs,
    partial and quickLoadMs.
  - **Removed from the critical path** (first route to final card), in the order the timeline showed them:
    (1) members' roads: the plan waited up to 1.5 s (signed out 0.2-0.3 s for "sign in" on every plan); now kept per
    cell on the phone, signed out not asked, 0.25 s budget, the fresh answer into the after-card plan;
    (2) a second build and draw of our quickest when it is the pick (0.2-0.4 s); now it is kept, alternates or not;
    (3) localTime's formatToParts per sample (75 ms of each ranking on 30 km), now per minute and zone;
    (4) the engine re-evaluating a candidate for every ranking of the same pool (lead, Prefer, three level cards);
    (5) the pick's track queued behind a track built ahead that the ranking didn't pick: a second analysis worker,
    started with the first (its own start was 0.2-0.3 s when made late);
    (6) the page's turn before a track built ahead (it waited 0.1-0.35 s behind the map's frames);
    (7) the routes' light geometry on the page: now made in the routing worker, the same function on the same line;
    (8) the plan's tile loading competing with the first route's in the worker (0.1-0.3 s on a first visit);
    (9) a first plan made on the line's tiles alone picked a 37 min route against 27 (Harrison cold): the corridor's
    tiles get 0.7 s first, and the refine replaces a route the whole corridor shows is over budget.
    Not on it (checked): Valhalla's checks (after the first draw, joined only when in), its instructions (swap in later).
  - **Live, 8 cases, local serve of web/ (as the app bundles it) with /api relayed to production; before = origin/main
    at #305, after = this branch on it; ms from Enter: first route drawn / final card; cold = a fresh profile, warm =
    the same profile reopened (tiles in IndexedDB):**

    | case | before cold | after cold | before warm | after warm |
    |---|---|---|---|---|
    | subdivision fun | 207 / 1078 | 225 / 517 | 176 / 880 | 230 / 463 |
    | subdivision4 fun | 195 / 873 | 199 / 602 | 223 / 662 | 240 / 583 |
    | northgate fun | 369 / 1510 | 404 / 1291 | 213 / 1152 | 277 / 992 |
    | harrison fun | 384 / 1446 | 404 / 1235 | 425 / 1500 | 396 / 1174 |
    | colerain quick | 388 / 981 | 371 / 728 | 339 / 921 | 309 / 648 |
    | colerain fun | 388 / 1222 | 343 / 880 | 414 / 1268 | 382 / 921 |
    | colerain max | 271 / 1422 | 329 / 923 | 274 / 1130 | 422 / 912 |
    | owner1 fun | 243 / 976 | 347 / 848 | 241 / 837 | 232 / 635 |

    The pick is the same route as before's in 16 of 16 runs (scratchpad instant/judge2.js). Met: the first route under
    0.5 s warm (8/8), the final card under 1.5 s cold (8/8). Not met: the card under 1 s warm in 6 of 8 (harrison 1.17 s,
    northgate 0.99 s; what's left there is the context's main-thread work 0.15-0.25 s, the first ranking 0.1 s and the
    pick's track analysis 0.15-0.2 s, sight distance being most of it). Numbers in a headless browser whose map renders
    in software on a loaded 4-core box: noisy by 0.1-0.2 s; production (the tiles over the network) is slower cold.
  - **Offline, demonstrated** (e2e "offline: plan a route and a loop from our tiles with no network": every request but
    the app's own files refused, then the browser's offline switch as well): Quick, Fun and Long way to a saved place
    in 0.4-0.7 s each with our own turn instructions, the card saying "No signal: the weather and live road events on
    this route aren't known."; typed search says it is offline; a map tap's coordinates route; a loop from our tiles; a
    plan with the browser offline. Before this branch the same flow failed only on the card (the weather line was
    hidden, read as "nothing to say"). Can't work offline: typed search, the basemap where no area was saved, weather,
    events, live hazards, Valhalla's maneuvers (lanes, exits), posted limits from map matching, members' roads not kept,
    region tiles never fetched, the traffic detour.
  - **Valhalla, call by call, where our tiles cover the trip** (after this round):

    | call | where | on the critical path? | still needed for |
    |---|---|---|---|
    | `valhallaRoutes([from, to], 2)` (its quickest) | funRoute check | no: asked after the first route is drawn, joins the ranking only if in when our context is | the one clock (oneClock), a sanity check; the route when ours fail |
    | `valhallaRoutes(..., highwayCosting)` | funRoute check | no (as above) | the same |
    | OSRM after a failed Valhalla check | funRoute | no | the fallback's fallback |
    | `valhallaMatrix` + stage legs (`connectorCosting`) | funRoute stage plans | skipped with our routes | trips off our tiles |
    | `trace_route` (turn instructions) | ownInstructions, ownInstructLater | no: ours go up with the route, Valhalla's swap in when they come (3 s cap) | lane, exit and roundabout wording until ours are as good |
    | stage discovery + `valhallaMatrix` + stage legs + circle | buildLoop | **was** (every loop waited for them); now after the card (loopRefine) when our tiles have loops | loops off our tiles; stage loops that the level ranks first |
    | `valhallaRoutes(points)` | reroute | **was** (a reroute needed the network); now our `through` where the tiles cover | reroutes off our tiles |
    | `valhallaRoutes(pts)` | Best roads nearby's road, a suggestion, Drive it again, a road link, buildRoute(points) (Home, a link's or GPX file's stops) | **was**; now our `through` | the same, off our tiles |
    | `valhallaMatrix` | Explore (Best roads nearby list) | skipped with our tiles (already) | off our tiles |
    | `valhallaRoutes` + `exclude_polygons` | trafficDetour (iOS, Apple traffic) | not planning: during a drive, after a jam | needs Valhalla's jam polygons; needs the network for traffic anyway |
    | `trace_attributes` | attachLimits (posted limits on the card and the strip) | no (after the card) | limits; offline they stay unknown (2026-11-08: ours from the tiles, below) |
    | `trace_attributes` | contributor.js (an upload's OSM way lines) | no | contributions (online anyway) |

- 2026-11-08: instant, offline limits, Valhalla down (branch claude/own-routing-instant-2; CALL_SHEET 2026-11-08):
  - **Removed from the critical path** (after #306's nine): (10) sight distance in the pick's track: an exact faster
    `sightDistanceM` (a sightline well inside what every point between allows skips the point-by-point test; the same
    answers, randomized parity test against road_dna.py), 5x on 30 km; (11) every one of our candidates' tracks built
    ahead in both analysis workers while the context runs, not only the lead's; (12) the engine's samples kept per
    context and corridor; (13) the plan's time-only search is the first route's when asked on the same view for the
    same trip (graph_router.js `quickKey`; the same routes, 60-80 ms of the worker's time warm); (14) the towns along our
    routes looked up while the context runs; (15) the posted limits laid in a task after the card.
  - **Live, 8 cases** (local serve of web/ with /api relayed to production, the same session back to back; before =
    main at #306, after = this branch; ms from Enter: first route drawn / final card):

    | case | main cold | branch cold | main warm | branch warm |
    |---|---|---|---|---|
    | subdivision fun | 113 / 291 | 109 / 278 | 109 / 223 | 116 / 249 |
    | subdivision4 fun | 128 / 364 | 152 / 378 | 152 / 382 | 134 / 387 |
    | northgate fun | 145 / 511 | 147 / 440 | 199 / 516 | 131 / 515 |
    | harrison fun | 226 / 686 | 185 / 577 | 263 / 694 | 198 / 588 |
    | colerain quick | 181 / 368 | 175 / 391 | 208 / 417 | 180 / 297 |
    | colerain fun | 166 / 531 | 168 / 459 | 208 / 495 | 183 / 463 |
    | colerain max | 184 / 593 | 177 / 541 | 179 / 466 | 162 / 518 |
    | owner1 fun | 176 / 450 | 156 / 398 | 159 / 441 | 146 / 418 |

    The pick is main's in 16 of 16 runs (judge2.js), and in 16 of 16 for 2d41b40 against main earlier in the session.
    Met in every case and run: the card under 0.7 s warm and 1.0 s cold, the first route under 0.4 s warm. This box was
    much less loaded than on 2026-11-07 (main's own harrison warm card 0.69 s against 1.17-1.5 s then), so the gain over
    main is the smaller number here: 0.05-0.1 s on the long trips, within the noise on the short ones. What is left
    between the first route and the card, warm harrison: the worker's plan to 0.28 s, the context 0.14 s (graph, driver,
    conditions on the page), the lead ranking 0.05-0.08 s, a map frame and the track's message 0.04 s, draw and card
    0.05 s (the card's road character line 0.02 s of it).
    Re-measured after a container restart on a box shared with another agent's e2e run (load 4-6 on 4 cores): 8 cases
    plus 3 more pairs of harrison, owner1 and northgate, main and branch interleaved. Neither meets the targets on the
    long trips there: warm card harrison main 694/785/1254/617 against branch 880/1300/750/536 ms, owner1 943/765/721/575
    against 345/707/568/366, northgate 661/832/738/518 against 565/639/516/760; cold harrison main 1159/1253/767/932
    against 611/946/773/1151. The branch is no worse than main under load and better on most runs; the pick is main's
    in 34 of 34 runs. Under contention the context's page work and the 5 tracks' analysis (two workers) share the cores.
  - **Posted limits offline:** on our routes the limit sign, the strip and the ETA's envelope take each edge's posted
    limit from the tiles (§5 Posted limits); the offline e2e flow asserts a posted limit is known on every plan (Quick,
    Fun, Long way, a map tap) and that no `trace_attributes` was asked. `trace_attributes` stays for lines off our tiles
    and for contributions.
  - **Valhalla down** (e2e "valhalla down: planning inside our tiles is unaffected": every Valhalla and OSRM request
    refused for two plans, then left hanging for two more): the card within 1.0 s cold and 0.7 s warm, the first route
    within 0.4 s warm, our own turn instructions, the tiles' limits, no failure said; after Valhalla's waits run out
    (the instructions' 3 s, the checks' 2.5 s) the route keeps ours; a loop within 1.5 s. Fixed: a loop from our tiles
    waited for the route context's `router` provider (Valhalla `trace_attributes` map matching, its 2.4 s budget): 2.9 s
    with Valhalla hanging, now 0.6 s; that provider is skipped for the loops of a plan where our tiles have loops (the
    graph provider scores any line from the tiles), ours and the map's stage loops alike.
  - **What still uses Valhalla where our tiles cover the trip** (the complete list):

    | call | where | when | for |
    |---|---|---|---|
    | `route` (its quickest, its highway-friendly one), OSRM after it | funRoute checks | after the first route, joined only when in by our context | a sanity check and the one clock (oneClock) |
    | `trace_route` | ownInstructions, ownInstructLater | after the card, 3 s cap; offline or down ours stay | lane, exit and roundabout wording (optional) |
    | `sources_to_targets` + stage legs (`route`) | loopRefine | after a loop's card | the map's stage loops, which replace ours only when ranked first |
    | `route` + `exclude_polygons` | trafficDetour (iOS, Apple traffic) | during a drive, after a jam | the live traffic detour (needs the network for traffic anyway) |
    | `trace_attributes` | contributor.js | an upload | contributions' OSM way lines |
    | `sources_to_targets` | crew_meet.js (Fair for the crew) | on a tap, opt-in | the crew's fair meeting point (not planning) |

    Loops have no turn instructions from either router (as on main). Off our tiles (no tiles for the area, or our
    router failing) every call is as before: Valhalla plans (stage plans,
    matrix, legs), Explore's matrix, points routed, reroutes, map-matched limits (attachLimits) and router_edges' context.

- 2026-11-08 (later): the levels' highway rule (branch claude/level-rules; CALL_SHEET 2026-11-08 (later)): the owner,
  "fun should never go on the highway. Quick should essentially be a normal route". §5 "The levels". Our router at Fun
  and Long way: `freeQuickest` (the hard filter, `ban`), else the exception's `hwyX` x25; `quickest()` gives the
  highway-free quickest at those levels (memoised as `free`, so the plan reuses it), the plan keeps the true quickest in
  the pool, `hwy.absurd` skips the bisection; `through` per leg; loops per leg (`loopLeg`, turning round where an arrival
  leaves only a highway ahead). Live before and after (highway km on the shown track, minutes over Quick):

  | case | level | before: highway km, min over Quick | after: highway km, min over Quick | after: the why line |
  |---|---|---|---|---|
  | work to home | Quick | 22.4, +0.2 | 22.4, +0.2 | (none) |
  | work to home | Fun | 25.5, +7.9 | 0, +22.7 | No highway-free way in a sensible time; Quick is the way |
  | work to home | Long way | 31.2, +13.1 | 0, +22.7 | the same (the same 44 min route) |
  | owner1 | Quick | 0, +4.7 | 4.0, 0 | (none: the quickest) |
  | owner1 | Fun | 0, +6.4 | 0, +4.2 | Avoids 1.7 mi of strip malls · 9 more good corners · nicer country, +4 min |
  | owner1 | Long way | 0, +16.6 | 0, +14.4 | 16 more good corners · avoids 1.7 mi of strip malls · nicer country, +14 min |
  | colerain | Quick | 6.6, 0 | 6.6, 0 | (none) |
  | colerain | Fun | 6.6, +0.5 | 0, +2.2 | The quickest way off the highway is a good road too. Over the 17 min route: fewer side streets · its extra corners are on side streets or between houses |
  | colerain | Long way | 6.6, 0 | 0, +2.2 | the same |
  | northgate | Quick | 8.5, +1.1 | 4.6, 0 | (none: the quickest) |
  | northgate | Fun | 8.5, +1.1 | 0, +1.5 | Nicer country, +1 min |
  | northgate | Long way | 8.5, +1.1 | 0, +3.8 | Nicer country, +4 min |
  | harrison | Quick | 0, +2.7 | 21.7, 0 | (none: I-275 and I-74, the quickest) |
  | harrison | Fun | 9.9, +7.5 | 0, +9.7 | 27 more good corners · avoids 0.8 mi of strip malls · open roads at 45 mph, +10 min |
  | harrison | Long way | 9.9, +7.5 | 0, +16.1 | 38 more good corners · avoids 0.8 mi of strip malls · back roads at 45 mph, +16 min |
  | subdivision | all three | 0, 0 | 0, 0 | Fun, Long way: No great roads on this trip: Quick is the way |
  | loop Winton Woods 30 mi | Fun | 0 of 69.2 km | 0 of 69.2 km (the same loop) | |
  | loop Sharon Woods 30 mi | Long way | 0 of 61.8 km | 0 of 61.8 km (the same loop) | |
  | loop Fountain Square 30 mi | Fun | 7.3 of 66.8 km | 0 of 44.1 km | |
  | loop Fountain Square 30 mi | Long way | 1.5 of 56.4 km | 0 of 65.7 km | |
  | loop Miami Whitewater 1 h | Long way | 0 of 40.7 km | 0 of 40.7 km (the same loop) | |

- 2026-11-04 (region grid): the context grid for OH+KY+IN on graph-data ctx/v1 (ctx-region.yml, 6 shards, 32 min):
  33 bundles, 35.6 MB, 1.46 M HPMS road spans, 13,574 fatal crashes; served at /api/ctx/v1/ (KV first, then the branch).
  The region graph was rebuilt with it (build 2026-45-95960e6d-gebab6b, 584 tiles, 228.9 MB; Columbus tile 388_519:
  known share of the model's weight 0.65 -> 0.76), and the shipped Cincinnati set is that build's 16 tiles (17.4 MB),
  committed by the workflow. The relay asks raw GitHub with Cloudflare's subrequest cache (a week, keyed by build);
  timed on the preview, repeats were 0.3-0.8 s against 0.6-1.0 s first, too noisy from here to call a cache hit.
