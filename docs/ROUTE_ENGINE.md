# The route engine

How Vetta decides which way is worth driving: `web/route_engine.js` (the model and the plan search's pieces),
`web/route_ctx/registry.js` (the route context: corridors, providers, one budget), and the providers in
`web/route_ctx/<name>.js`. This page is the reference for anyone adding a data source: the channel names, units and how
each one enters the model are below. docs/ROUTING.md says how the planner uses it; docs/ROAD_INTELLIGENCE.md §7 why.

## Why a model and not a curvature score

Kurviger and Calimoto rank by curvature with road-class switches ("avoid highways", "curvy level"); REVER by community
roads; the scenic and pleasant routing papers (Quercia et al.'s *Shortest path to happiness*, crowd-photo scenic routing,
road-network attractiveness learned from trajectories) by one attractiveness number per edge under a time budget. All of
them fold "is this road worth driving" and "is it twisty" into one score, which is exactly how a curvy subdivision wins:
five good corners in 1.3 km of Menominee Drive beat Pippin Road (the owner's bad case, now a test). The owner: "You can
build a curvy route with just road data but a good route takes road intelligence."

So every 25 m of a candidate gets two separate scores, and the corners only count where the road deserves them:

- **quality** (0–1): is this a road worth driving at all? Speed limit, class and use, density, signals, stops and
  crossings, driveways and side roads, traffic calming, businesses, land use, buildings, night lights, impervious ground,
  addresses, housing, noise, traffic volume, surface, crowd roughness and flow.
- **scenery** (0–1): what it's like: forest and canopy, water and creeks, ridges and relief, open country, parks, photos,
  autumn colour, old roads, loved roads, guardrails and curve signs, banking.

## The model

### Per sample

`samples(corridor, ctx)`:

- **Quality** is a weighted *geometric* mean of every known quality term's goodness (each term maps its value to 0 worst
  … 1 best), times the square root of the worst of the *damning* families (speed, road, stops, access, business). The
  geometric mean means a 0.1 is not averaged away by five 1.0s; the soft minimum means plenty of absent signals can't make
  a 25 mph side street, a driveway every 30 m or a row of shops a good road. Values on real roads (Cincinnati fixtures):
  country back roads 0.6–0.85, interstates 0.65–0.75, suburban collectors 0.3–0.45, subdivisions 0.1–0.25, strip-mall
  arterials 0.05–0.25.
- A motorway or ramp has no frontage: the built and business terms (shops, houses, lights beside it) are skipped there.
- A "residential" road with router density ≤ 2 and no sidewalk is read as a country lane (US TIGER imports tag county
  roads residential), class unclassified and an estimated 35 mph.
- **Scenery** is a weighted arithmetic mean (one nice thing is nice).
- **Confidence** per sample is the share of the possible weight that was known. Unknown terms drop out of both means.

### Per candidate

`evaluate(cand)` adds up, along the corridor:

| term | what | points |
|---|---|---|
| fun | ApexFunRoute.score with each corner's weight times the **quality gate** where it is: 0 at quality ≤ 0.25, full at ≥ 0.6 | 0–100 |
| gain | 0.5 × gated good corners gained over the quickest (cap 60), as before | ≤ 30 |
| quality | 0.3 × (route quality − 50) × how much is known (full once a third of the weights is known) | ±15 |
| scenery | 20 × mean(scenery − 0.5) weighted by how much of it is known (full at 35 %) | ±10 |
| poor | −3 per km of side street or business district: smooth from quality 0.45 down, full at 0.25; the first and last 1.2 km are free (every trip starts in a street); cap 60 | ≤ 0 |
| bonuses | byways 0.4/km (cap 12), viewpoints 1.5 (cap 6), a covered bridge 2, history 0.5, a waterfall 1, tunnels 1.5 (if preferred), fresh asphalt 0.3/km, golden light on west-facing ground (0.5/km, cap 4); all bonuses cap 15 | ≤ 15 |
| penalties | per km and per span at the time you'd be there (below); cap 40 | ≥ −40 |
| time | − the level's perMin × extra minutes (Quick 3, Fun 1, Max 0.35) | |
| glare, towns, weather, measured, taste, prefer | today's terms, unchanged: glare 1/min (cap 20), towns 3/km (cap 60, when avoided), weather (ice 30, storms 15, rain 6, fog 4 by share, relative), members' roughness/banking −8…+5, taste ±8, the Prefer stamps | |

`value` is their sum; `rank` drops candidates past the level's budget (as before) and any with a hard constraint, unless
every candidate fails one (then they stay, flagged, and the card says what). **With no context at all the value is
exactly ApexFunRoute.rank's**, value for value (tests/test_route_engine.py runs 600 random pools): when every provider is
slow or down, routing is today's.

### Time-dependent penalties

Each sample has `etaAt` (the router's maneuver clock placed on the line, else its total spread by distance, else 50 km/h;
times the driver's live pace while driving). At that time, in the phone's local time:

| term | when | cost |
|---|---|---|
| `deer_risk` | sun −10°…+8° (full), night 0.35, day 0.1 | 1.5/km |
| `fog_vis_m` | as forecast; ×1.5 in a valley (TPI ≤ −10 m), ×0.5 on a ridge (TPI ≥ 20 m) | 1.2/km below 1 km |
| `crosswind_ms` | on bridges and ridges only | 0.6/km over 8 m/s |
| `road_temp_c` | cold tyres | 0.25/km below 7 °C |
| `cyclist_route` | Sat/Sun 7–11 | 0.5/km |
| `park_visitors` | Sat/Sun 9–18 | 0.5/km |
| `unlit` | after dusk (sun < −6°), only with the "avoid unlit roads" preference | 0.6/km |
| school spans | Mon–Fri 07:00–08:45 and 14:00–16:15, Aug–Jun (unless the span says) | 2 + 1/km |
| church spans | Sun 08:00–12:30 | 1 |
| event spans | the span's own windows | 6 |
| works spans | always (or its window) | 4 + the delay in minutes × perMin |
| harvest spans | Sep–Nov, 07:00–20:00 | 0.5/km |
| level crossings, one-lane bridges, deer crossings (×3 at dusk), speed bumps, stop signs | points | 0.7, 0.5, 0.3, 0.5, 0.4 each |
| a passenger aboard | hairpins and 1–2s | 0.3 each (cap 15) |

A span or point may carry `when: { windows: [[startMs, endMs]], weekly: [{ days: [0–6], from: 'HH:MM', to: 'HH:MM' }],
months: [1–12] }` (weekly windows may wrap midnight); none means always, or the kind's default above.

### Hard constraints

A `closure` or `no_access` span active at the time; `flood` with value ≥ 1 (water over the road); a car that doesn't fit
(`maxwidth_m`, `maxheight_m`, `maxweight_t` under the Garage car's width, height or weight); unpaved (`surface` ≥ 3) for
a low car; a gap between `fuel` points longer than 85 % of the car's `range_km`.

### The why line

`why(best, quick)` takes the parts of the value that separate the winner from the quickest most and says the top 2–3:
"Highway instead of 1.2 mi of side streets"; "Avoids 2.1 mi of strip malls · 6 signals (not 18), +1 min"; "14 more good
corners · back roads at 45–55 mph · through forest, +4 min"; "Deer hour: open roads"; "1.9 mi less in towns". When
nothing the context knew made the difference, the old line (the roads it's for and its corners) is said.

## The plan search

- **Candidates**: the router's route and two alternates (its costing keeps off highways); **the highway-friendly
  quickest** (`highwayCosting`, use_highways 1.0) unless the driver avoids highways, which is what fixes routes through
  subdivisions and business districts; stage plans; loops; Explore.
- **The network**: before plans are timed, the 8 best stages (12 for Explore) get the stage-capable providers (the
  router's edges by map matching, the DEM) in 1.2 s, and `rescoreStages` multiplies each stage's map score by
  (0.4 + 0.6 × its mean corner gate) × (1 + 0.4 × (scenery − 0.5)): a twisty subdivision street falls to 40 % and
  behind a real back road before any connector is timed.
- **Connectors**: the matrix and the stage plans' routes use `connectorCosting` (use_highways 0.6, avoid-highways kept):
  the good roads are pinned by shaping points, so this only changes how the plan gets between them: fast roads, not
  cut-throughs. A detour must then buy real quality: its gated corners, quality and scenery against its minutes.
- **The quickest always competes**; if the alternatives are worse roads, it wins.
- A winning router alternate or highway-costed route is pinned with shaping points, so a reroute keeps to it.
- **Loops** and **Explore** use the same model (`loopValue`, `rescoreStages`).

## Instant

Where to? never waits on the context (REVIEW_FEEL budgets): the providers get 2.5 s together for a plan's candidates
(1.2 s for stages), each provider within its own budget and an AbortSignal; what came back is used and the rest is
unknown. If planning takes longer than 1.5 s the quickest route goes up at once and the ranked routes replace it when
they're ready, unless you've started driving it or planned something else.

## Calibration

`tools/route_engine_fixtures.js` captures real cases (the router's candidates under both costings and any stage plan,
each candidate's edges from trace_attributes, its terrain from the real DEM tiles, the businesses beside it from the
OpenFreeMap poi layer; Overpass was unreachable from the capture machine) into `tests/fixtures/route_engine/`, and
`tests/test_route_engine_calibration.py` asserts the order a driver would pick (`tests/route_engine_harness.js` rebuilds
each case as the app would):

| case | candidates | engine | old ranking |
|---|---|---|---|
| subdivision (Pippin Road vs Menominee Drive, 5 good corners in 1.3 km) | 5.6 min vs 9.2 min | Pippin Road at every level | Menominee at Fun and Max |
| northgate (Springdale and Mill Roads vs I-275) | 12.0 / 14.4 / 14.7 vs I-275 11.4 min | I-275 at every level | Pippin and Kemper at Fun and Max |
| colerain (Colerain Avenue: 18 signals, 244 businesses beside it) | 17.6 vs Pippin and Struble 19.0, Blue Rock 21.2 | Pippin and Struble (Quick, Fun), Blue Rock (Max) | Colerain Avenue |
| harrison (the fixture drive's country) | I-275/I-74 22.0 vs Lees Creek and Day Roads 26.1 | the highway at Quick, the back roads at Fun and Max | the same |

Property tests (tests/test_route_engine.py): no context = the old ranking exactly; a channel all unknown changes nothing;
every quality term monotonic in the right direction and the route value with it (speed limit up never hurts; businesses,
signals, driveways, density up never help); every catalogue channel below moves the ranking the right way; the time
windows, bonuses, hard constraints and the why line.

## The channels

Builders: **A** router edges and DEM (`router_edges.js`, `dem.js`, built); **B** map tiles and OSM/Overpass features;
**C** the national-data grid; **D** time and world (weather, sun, deer, events, flood, works); **E** driver, crowd and
in-car. Per sample unless marked span/point. NaN is unknown, never 0. A channel two providers give is merged per sample:
the lower `priority` provider wins where it knows, the other fills its gaps.

### Quality (weight; goodness)

| channel | unit | from | weight | goodness |
|---|---|---|---|---|
| `speed_limit_kph` | km/h | A | 3 | 30→0, 40→0.03, 56→0.35, 72→0.7, 89→0.95, 105→1 (never falls with speed) |
| `speed_limit_est_kph` | km/h | A (flag: an estimate) | 1.2 | the same, only where no limit is posted |
| `mapillary_limit_kph` | km/h | B (sign photos) | 2.5 | the same, where no limit is posted |
| `speed_kph` | km/h | A | 0.8 | the same, only where neither limit is known |
| `road_class` | 0 motorway … 7 service | A | 2 | 0.55, 0.6, 0.65, 0.85, 0.95, 0.85, 0.12, 0.05 |
| `road_use` | Valhalla use code | A | 2 | road 1, ramp 0.6, track 0.3, driveway/parking/alley/living street 0, service 0.08 |
| `density` | 0–15 | A | 2 | ≤2 → 1, 6 → 0.55, 11 → 0.05 |
| `signals_per_km` | /km (±500 m) | A (B fills) | 2 | e^(−n/1.5) |
| `stops_per_km` | /km | B | 1.5 | e^(−n/1.5) |
| `crossings_per_km` | /km | B | 0.8 | e^(−n/2.5) |
| `access_per_km` | side roads and driveways /km | A (B fills) | 1.5 | e^(−n/25) |
| `calming_per_km` | speed bumps, chicanes /km | B | 2 | e^(−n/0.7) |
| `lanes` | count | A | 0.5 | ≤2 → 1, 4 → 0.6, 6 → 0.5 |
| `divided` | 0/1 | B | 0.4 | 0.6 if divided |
| `surface` | 0 smooth … 7 impassable | A | 1 | paved 1, rough 0.7, compacted 0.4, gravel 0.2, dirt 0.15 |
| `sidewalk` | 0/1 | A | 0.7 | 0.3 with |
| `truck_route` | 0/1 | A (B: hgv) | 0.4 | 0.7 if a truck route |
| `access_destination` | 0/1 | B | 2 | 0.1 if destination-only |
| `business_per_km` | /km within 80 m, excluding fuel and cafés | B | 2.5 | e^(−n/6) |
| `landuse_urban` | share commercial/retail/industrial | B | 1.5 | 1 − v |
| `landuse_residential` | share | B | 1 | 1 − 0.8 v |
| `buildings_per_ha` | /ha within 100 m | B | 1 | e^(−v/3) |
| `night_light` | VIIRS nW/cm²/sr | C | 1 | 1 − ln(1+v)/ln 51 |
| `impervious_pct` | NLCD % | C | 1 | 5 → 1, 50 → 0 |
| `address_per_km` | /km | C | 1 | e^(−v/40) |
| `housing_per_km2` | Census housing units /km² | C | 0.8 | e^(−v/300) |
| `noise_db` | BTS road noise dB | C | 0.6 | 50 → 1, 70 → 0 |
| `aadt` | vehicles/day (HPMS) | C | 1.5 | ≤1000 → 1, 25 000 → 0 (log) |
| `traffic_ratio` | live speed / free flow | E | 1 | v |
| `iri` | HPMS IRI in/mi | C | 0.8 | 60 → 1, 200 → 0 |
| `crowd_rough_g` | members' rms g | E | 1 | 0.05 → 1, 0.38 → 0 |
| `crowd_flow` | 0–1 | E | 1 | v |
| `hgv_share` | share of trucks | C | 0.5 | 1 − v/0.3 |

Families for the soft minimum: speed (the limits), road (class, use, lanes, divided, truck, destination), stops
(signals, stops, crossings, calming), access, business (businesses, urban land use). Built: density, sidewalk, buildings,
lights, impervious, addresses, housing, residential land use.

### Scenery (weight; goodness)

| channel | unit | from | weight | goodness |
|---|---|---|---|---|
| `forest_share` | 0–1 within 100 m | B | 1.5 | v |
| `canopy_pct` | NLCD tree canopy % | C | 1.2 | 0 → 0.15, 70 → 1 |
| `water_near` | 0–1 | B | 1 | v |
| `creek_follow` | 0/1 (a stream within 150 m, parallel) | B | 1 | 1 / 0.35 |
| `open_country` | farmland/grass share | B | 0.6 | 0.4 + 0.45 v |
| `protected` | 0/1 park or protected area | B | 1 | 1 / 0.4 |
| `photo_per_km` | geotagged photos /km (Wikimedia, Flickr) | B/D | 1 | 1 − e^(−v/3) |
| `tpi_m` | m (+ ridge, − valley) | A | 0.8 | \|v\|: 0 → 0.25, 40 → 1 |
| `relief_m` | m within 800 m | A | 1 | 10 → 0.1, 150 → 1 |
| `foliage` | 0–1 autumn colour | D | 0.8 | v × canopy/70 (only with `canopy_pct`) |
| `old_road` | 0/1 (Old, Pike, Hollow, Mill …) | B | 0.5 | 1 / 0.45 |
| `built_year` | median year built (parcels) | C | 0.3 | 1900 → 1, 2000 → 0.2 |
| `loved` | 0–1 (drive-it-again, votes, crew favourites, stages) | E | 1.5 | v |
| `guardrail` | 0/1 | B | 0.3 | 0.9 / 0.5 |
| `curve_signs_per_km` | /km | B | 0.4 | 1 − e^(−v/2) |
| `crowd_camber_deg` | ° into the corner | E | 0.5 | −3 → 0, 0 → 0.5, 4 → 1 |

### Penalties per km (see the time table above)

`deer_risk` (0–1, D), `fog_vis_m` (m, D), `crosswind_ms` (m/s, D), `road_temp_c` (°C, D), `crash_rate` (crashes /km/yr,
C; 0.6/km at 5), `cyclist_route` (0/1, B), `buggy` (0/1, B; 0.8/km), `unlit` (0/1, B/C), `snow_cover` (0–1, D; 2/km),
`crowd_busy` (0–1 at that hour, E; 0.6/km), `park_visitors` (0–1, D), `signal_coverage` (0–1 FCC, C; 0.15/km without).

### Spans and points (`kind`)

Hard: `closure`, `no_access`, `flood` (value ≥ 1). Penalties: `school`, `church`, `event`, `works` (value: minutes),
`harvest`, `unploughed`, `level_crossing`, `one_lane_bridge`, `animal_crossing`, `speed_bump` (only without
`calming_per_km`), `stop` (only without `stops_per_km`). Bonuses: `byway`, `viewpoint`, `covered_bridge`, `historic`,
`waterfall`, `tunnel` (with the tunnels preference), `resurfaced`. Shown, not ranked: `camera` (Avoid → Cameras asks the
router), `signal`, `junction`, `driveway`, `climb`, `descent`, `bridge`, `tunnel`, `toll`, `roundabout`, `unpaved` (A).
`fuel` points feed the range check. Other kinds are kept for the card and ignored by the ranking.

### Built by A

`router_edges.js` (priority 10, budget 2.4 s, stages too): one trace_attributes per candidate on its exact line
(`edge_walk`, falling back to `map_snap` on at most 2000 points; stages are snapped), the 21 attributes the model reads,
two at a time, kept 30 min per candidate. `dem.js` (priority 20, budget 2 s, stages too): the z12 Terrarium tiles the
map uses (and the offline cache keeps), at most 64 for a plan (shortest corridors first); `elev_m`, `grade_pct`,
`relief_m`, `tpi_m`, `aspect_rad`, `west_descent`, climb/descent spans.

## Adding a provider

1. `web/route_ctx/<name>.js`, loaded after `registry.js` in web/index.html (the service worker caches `route_ctx/`).
2. A header listing each channel: name, unit, meaning, source, licence and attribution, update cadence. Use the names
   above; a new channel needs a row here and a term in `route_engine.js` (QUALITY, SCENERY, PER_KM or SPANS) with a test
   in tests/test_route_engine.py that it moves the ranking the right way.
3. `ApexRouteCtx.register({ id, version, channels, needs: { network, key? }, budgetMs, priority, stageOk, fetch })`.
   `fetch(corridors, { signal, budgetMs, departAt, settings, fetch })` resolves per corridor id to `{ status, note?,
   channels: { name: Float32Array(len) }, spans, points }`. Batch one request for the union bbox
   (`ApexRouteCtx.unionBox`), cache per tile or cell with a TTL (`ApexRouteCtx.cache`), race mirrors like web/cameras.js,
   respect the signal, and return `unavailable` rather than throw. Never fill unknown with 0.
4. Keys: `needs.key` names a setting; `settings` comes from `apex.routeKeys` on the phone for now; a provider whose key
   is missing is `no-key` and never runs. The owner creates keys (docs/OWNER_TODO.md).
5. Pure parsing and aggregation exported for tests (tests/test_route_ctx_<name>.py on a real response, small).
