# Idea backlog

The long list of everything that could make Vetta best in class. It is a menu, not a
plan: threads pick from it, turn a picked idea into a concrete task (in their own PR, or a
row in docs/WORKER_QUEUE.md when it needs a written brief), and come back here to update the
status. Anyone may add, split, merge, re-rate or drop ideas; keep the id stable once an idea
has one, and never reuse an id.

Owner goal (2026-10-27): keep looping until every area is best in class. The areas are
fun routing, driver and road analysis, social, and UI first; the rest of this file is what
makes those four trustworthy in production.

## How to read a row

| column | meaning |
|---|---|
| id | Stable handle (`R-12`). Reference it in PR titles or bodies so the next thread can find the work. |
| impact | **H** changes why someone picks Vetta over another app, or removes a reason to leave. **M** clearly better day to day. **L** nice, niche or polish. |
| effort | **S** one small PR. **M** a few PRs or one large one. **L** several PRs across core, web and native. **XL** a project in its own right (new platform, new data pipeline). |
| status | `done (#N)` shipped on main. `partial (#N)` a first version shipped, the rest of the row is not. `active (thread)` a thread is building it now. `todo`. `owner` needs an owner decision, money, an account or a phone test before it can move. `dropped (why)`. |
| from | Where the idea comes from: a doc in this repo, an owner request, or a competitor that does it well. |

## How to pick next

1. **Owner asks and broken things first.** Anything the owner reported from a phone, then
   anything that loses data, freezes, or shows something untrue (the honesty rule:
   unknown stays `--`, never fabricated).
2. **Then the coequal top priorities** in docs/WORKER_QUEUE.md (road intelligence, convoy
   hazard streaming), then this file.
3. **Within an area, take the best impact for the effort**: H/S, then H/M, then M/S,
   then H/L. Skip anything marked `owner` unless the owner just unblocked it.
4. **Prefer ideas that feed each other.** Measured road data improves routing, coaching,
   hazards and road pages at once; a thread that can choose should choose the foundation.
5. **Check for a collision before starting.** Look for `active` rows and open PRs on the
   same files (web/index.html is shared by almost everything); keep PRs small and merge
   origin/main in before merging.
6. **Claim, ship, record.** Set the row to `active (thread name)` in your first PR, `done
   (#N)` or `partial (#N)` when it merges, and add any new ideas you found on the way.
7. **Respect the guardrails below.** An idea that breaks one is `dropped`, however popular
   it is elsewhere.

## Guardrails (decided; do not build around them)

- Driver Score is technique only. No legality in the score, no public speed or time
  leaderboards; corner and segment times are shared only by explicit opt-in per friend and
  per crew (docs/SOCIAL.md, owner 2026-10-25).
- Zero subscription and zero budget backend (Cloudflare Workers + D1 today). A paid
  provider (traffic, tiles, routing) needs the owner's yes first.
- Never ship placeholder or synthesized road data as if measured. Single-pass hazards are
  "Driven once" until corroborated.
- Privacy by design: no per-user trace storage on the server, the first and last km of every
  trip stay on the phone, anonymous road learning is separate from private social sharing.
- Physics and signal math live in `/core` with JS (and Swift where live) parity tests.
- CarPlay waits for an Apple developer account; Android is low priority (owner 2026-10-25).
  Ideas for both are listed so they are ready when that changes.

---

## 1. Fun routing (R)

Today: Quick / Fun / Max fun A→B with stage detours and a map-only fun score (#82), loops
sized with real road distances (#85), measured roughness/banking moving route choice for
members (#88), off-route rerouting (#30, #34), From/To with current location (#28, #31),
long-press pin (#61), Apple place search and nearby suggestions in the app (#73).

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| R-01 | Fun level slider on the Plan sheet (Quick / Fun / Max fun) and "N min (+M for fun)" on the route card | H | M | done (#82) | Kurviger curvy levels, Calimoto |
| R-02 | Loops the length you asked for, from real road distances between stages | H | M | done (#85) | Calimoto round trips |
| R-03 | Measured road character (roughness, banking) as a routing input, unmeasured stays neutral | H | M | partial (#88) | ROAD_INTELLIGENCE §7, WORKER_QUEUE road-3 |
| R-04 | road-3 remainder: measured crest, flow confidence and corroborated hazards in candidate discovery and generation, not only in ranking | H | L | todo | WORKER_QUEUE road-3 |
| R-05 | Multi-centre stage discovery so long A→B trips find stages near both ends, not only the midpoint | H | M | done (#96) | STATE 2026-10-28 |
| R-06 | One fun score for loops and A→B (unify loop ranking with the fun score) | M | S | done (#111) | STATE 2026-10-28 |
| R-07 | Live ETA and time left from router durations scaled by your own pace, reset on reroute | H | M | done (#154) | WORKER_QUEUE eta-1, every nav app |
| R-08 | Traffic ahead on iOS from MapKit, switch to the next most fun route that avoids the jam | H | L | done (#78, phone test pending) | WORKER_QUEUE traffic-1, Waze |
| R-09 | Traffic on web/Android through a keyed provider (TomTom/HERE via the Worker) | M | M | owner (paid provider) | Google Maps |
| R-10 | "Explore": best stages within N minutes of here, as a list and on the map, one tap to drive one | H | M | done (#129) | ROAD_INTELLIGENCE §7.1, REVER discover |
| R-11 | Choose each stage's direction by score and car (climb the technical one, descend the flowing one) | M | M | done (stage ends' elevation from the Terrarium DEM; a technical stage climbed or a flowing one descended is worth 15% more in loop and detour ranking; the crow-fly fallback takes the better end when it costs ≤ 3 km more. Car-specific choice waits on D-19) | ROAD_INTELLIGENCE §7.2.3 |
| R-12 | Set list: order stages so intensity builds, rests, and finishes high; no three max-TECH stages in a row | M | M | done: the same stages in an order that finishes on the most technical one (tight corners per km) gain 4% of their value; three 2.5+/km stages back to back lose 25% (`FunRoute.setList`, in A→B, sectioned and loop plans) | ROAD_INTELLIGENCE §7.2.5 |
| R-13 | Sun glare penalty for headings within 20° of a low sun, using the existing solar formula | M | S | done (#123) | ROAD_INTELLIGENCE §7.2.6 |
| R-14 | Re-score the router's returned geometry and reject routes that shortcut a stage | M | S | done: `FunRoute.stageCoverage`: a stage plan whose returned route stays within 40 m of under 70% of any stage is dropped (A→B and loops); the router's own routes and the circle loop still compete | ROAD_INTELLIGENCE §7.2.4 |
| R-15 | Avoid options: highways, tolls, ferries, unpaved, towns, repeated roads, with honest "couldn't avoid" | H | M | done (#118, #136: towns as a ranking cost; repeated roads were already a loop cost, A→B plans never repeat a stage) | Kurviger, Calimoto, Google Maps |
| R-16 | Time budget routing: "I have 90 minutes, end at home" (orienteering with a hard time cap) | H | M | done (#122: 1 h / 2 h loops planned on drive time) | ROAD_INTELLIGENCE §7.1 |
| R-17 | Day trip builder: start, stops (food, fuel, viewpoint), finish, with drag-to-reorder vias | H | L | done: the route card lists your stops (Up, Down, Remove; `web/trip_stops.js`), a viewpoint, café or fuel pin along the route is one tap from being a stop (Add as a stop), plus drag-to-reshape and the pin's Add via. Reordering keeps your stops, not the planner's shaping points | Roadtrippers, Calimoto tour planner |
| R-18 | Drag the route line on the map to reshape it (adds a via) | M | M | done: drag the planned route (mouse at once, a finger after a 0.35 s hold so panning still pans); the drop becomes a stop in the grabbed point's order (`addViaAt`); held still, the long-press pin as before | Google Maps, Kurviger |
| R-19 | Archetype preferences in routing ("love esses, skip switchbacks"), sliders first, learned later | H | M | partial (Plan → Hairpins fewer/more and Sweepers fewer/more weigh each route's fun, fun_route.js cornerWeight, ±60%; learning it from your choices is R-33) | ROAD_INTELLIGENCE §5.4 |
| R-20 | Car-aware routing from the Garage (width, ride height, power: no goat tracks for a lowered car) | M | M | done: Garage cars carry ride height (lowered/stock/lifted) and width with mirrors (migration 0024); the daily car plans every route: lowered → no unpaved roads, width → Valhalla `width` (posted limits); the route card says so (`FunRoute.costing(avoid, car)`, `carNote`). Power changes nothing yet | SOCIAL §2.4 |
| R-21 | Weather-aware routing: penalise wet, icy, foggy or very hot stages from a free forecast; show why | M | M | done: the route card says the forecast along the way for the hour you'd reach each point (Open-Meteo, `web/route_weather.js`): ice, snow, storms, rain, fog, heat, or "no rain, ice or fog"; fun-route ranking charges the top candidates for ice, snow, storms, rain and fog on their own forecasts, by the difference from the driest (`ApexRouteWeather.cost`), so a drier way can win | Calimoto weather, REVER |
| R-22 | Seasonal and time-of-day closures (OSM `conditional` tags, seasonal mountain passes) | M | M | done: the route card reads OSM `*:conditional` closing rules on the route's roads (date ranges, months, times, weekdays) for when you'd get there: closed, closed at other times, or a rule it can't read shown as written (`web/conditional_closures.js`); "Route around it" sends the closure's point to the router as an excluded location and plans again, keeping your stops | Kurviger |
| R-23 | Fuel and charge range: warn before a long stage with no fuel; EV charger stops on loops | M | M | partial (fuel stations from the map along a planned route; the route card warns of 50+ mi with none; EV chargers and the car's range still to do) | Google Maps, ABRP |
| R-24 | Scenic layer: viewpoints, overlooks, waterfalls and car-friendly cafés along the route from OSM | M | M | partial (web/scenic.js + stages.js pois: OpenStreetMap viewpoints and cafés within reach of a planned route pinned on the map and counted on the route card, e.g. \"7 viewpoints · 1 café\" over Newfound Gap; waterfalls and car-friendly picks still to do) | Roadtrippers, Scenic |
| R-25 | GPX import (follow someone's route with our notes) and GPX/KML export of planned routes | M | S | done (Plan → Open GPX: a track is followed as drawn with our notes, route points or waypoints are routed through; route card → GPX exports the planned route; web/route_import.js) | Kurviger, Calimoto, REVER |
| R-26 | Open a shared route link from Google/Apple Maps or a GPX in the app ("Open in Vetta") | M | M | done (paste a Google Maps, Apple Maps or geo: link into Where to?: its start, stops and destination; \"Open in Vetta\" for .gpx files from Files, Mail and AirDrop. Short maps.app.goo.gl links must be opened in a browser first) | Waze deep links |
| R-27 | Our own routing graph with fun scores baked into edge costs (Valhalla custom costing) | H | XL | owner: needs our own routing server (a graph with fun baked into edge costs), which is the routing-server decision in OWNER_TODO (Y-04); until then fun lives in candidate generation and ranking | ROAD_INTELLIGENCE §7.3 |
| R-28 | On-device Valhalla with regional tiles built monthly by free CI, so routing works with no signal | H | XL | parked (XL): Valhalla builds for iOS, but it needs a native C++ target, a monthly regional tile build in CI and a tile download per area; F-02 already keeps the map, terrain and stage discovery offline, so offline routing is the remaining gap | ROAD_INTELLIGENCE §7.4, Calimoto offline |
| R-29 | Lane guidance and junction views at complex interchanges on the transit parts of a trip | M | L | done (lanes): the router's lane data (Valhalla `turn_lanes`) draws one arrow per lane under the next junction from a mile out, the lanes to use lit (web/lanes.js); the early call adds "use the left 2 lanes" when that's clear; numbered exits read as the sign ("Take exit 386B toward Airport"). Junction views (pictures of the interchange) not built: no free source | Google Maps, Apple Maps |
| R-30 | Multiple route options shown side by side on the map with Fun/Twist/Flow and time for each | H | M | done (#126) | Google Maps alternatives |
| R-31 | "Why this route" explainer: the stages it uses, what each adds, and what it cost in minutes | M | S | done (#115) | trust-building |
| R-32 | Benchmark roads (Tail of the Dragon, Big Sur, Stelvio, Route 33) must rank in their region's top decile; CI test | M | M | partly: `tests/test_benchmark_roads.py` scores saved map pieces of each region (`tools/make_benchmark_fixture.js`, `tests/fixtures/benchmarks/`) with the app's own stage scorer and finds the road by its name in the tiles. Tail of the Dragon is #1 of 49; CA-33 #3 of 28; Stelvio #6 of 31: only 4–7 of its 48 hairpins are found; zoom-14 tiles don't change that (checked), so stroke joining or corner detection under-counts dense hairpin sequences (todo); Big Sur #5 of 12 behind Nacimiento-Fergusson Road, a sweeper road rather than a technical one. Thresholds guard today's ranks | ROAD_INTELLIGENCE §6.2 |
| R-33 | Preference learning: after a drive, "which was better, A or B?" fits per-user and global weights | H | L | partly: per-user done. Each "Which road was better?" answer keeps both roads' TECH, FLOW (reference lap) and the phone's roughness; a logistic fit pulled toward equal weights learns your taste once you've answered 5 (`web/taste.js`). The Log says it ("you lean toward flowing roads (52%)…"), and fun-route ranking gives the top candidates up to ±8 fun points toward it. Global weights from everyone's answers need the server: todo | ROAD_INTELLIGENCE §6.3 |
| R-34 | Ramp/cloverleaf loops no longer read as Switchbacks (veto motorway links by road class) | M | S | done: the exporter's one map match also reads `edge.use`; a sector mostly on `ramp`/`turn_channel` is a Connector (`archetype(..., ramp=True)`); unknown use, no veto | STATE 2026-10-25 (c) |
| R-35 | Avoid known speed traps and ALPR cameras as a routing option, not only a note | M | S | done for plate readers; speed traps dropped: Avoid → Cameras sends the OSM/DeFlock cameras near the trip as `exclude_locations` (`FunRoute.camerasToExclude`, ≤50 with closures); too long a trip, the camera map offline or no way round: routed without, and said. Speed traps: dropped, since routing round speed enforcement serves speeding, not privacy (it fails the spirit of the guardrails, and warning of speed cameras is illegal in France, Germany and Switzerland); plate-reader avoidance stays a privacy option | DeFlock layer, Waze |
| R-36 | Crowd quiet hours: prefer stages that are empty at the time you'll arrive (from anonymous counts) | M | L | owner: needs the hour of each pass in road data (bucketed, merged), which the privacy page rules out ("never times"). Asked in OWNER_TODO | Strava heatmap, Google popular times |
| R-37 | Return-to-start "home by" mode on a loop that shortens itself live if you're running late | M | M | partial (a loop's route card takes a Home by time; driving it, a live arrival more than 5 min late offers Head home: the quickest way back to the start. The loop doesn't yet shorten itself by dropping a stage) | Calimoto |

## 2. Driver analysis and coaching (D)

Today: Driver Score (technique only), per-corner compare, segments, corner coach with
ideal drive and where to find time (#80), grip circle (#86), automatic mount calibration
(#64), camber and crest from the IMU.

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| D-01 | Corner coach: brake zone, trail braking, coasting and throttle point per corner, timed over the same stretch | H | M | done (#80) | Harry's Lap Timer, Garmin Catalyst |
| D-02 | Grip circle with the driver's own g-g envelope and per-corner grip use | H | M | done (#86) | RaceChrono, AiM |
| D-03 | Live coaching on a known road: spoken "brake later" / "carry more speed" from your best pass | H | M | done (#100: technique tips only; speed tips stay on the analysis page by design) | STATE 2026-10-28, Garmin Catalyst |
| D-04 | Ghost car on the map: your best pass (or a friend's shared ghost) as a moving marker with live delta | H | M | parked: a ghost that moves by time is a race against the clock on public roads (guardrails: never reward speed). D-05 gives the same "better than last time" by technique; a ghost belongs in track mode (D-15) | SOCIAL §3, racing games, Strava Live Segments |
| D-05 | Live delta bar during a known stage (green ahead / red behind your best, technique-scored, not speed-scored) | H | M | done (web/stage_delta.js: on a stage you marked in the Log, each finished corner is scored as the Driver Score does and compared with your best pass over the same corners; the result is said at the end) | Harry's Lap Timer |
| D-06 | Smoothness heatmap on the drive map (lateral jerk, abrupt inputs) with the three worst moments | M | S | done (#104) | Garmin Catalyst |
| D-07 | Consistency score across passes of the same road, and a trend over weeks | M | S | done (#114 per-corner repeatability; monthly braking-consistency trend) | Strava fitness trend |
| D-08 | Personal records feed: best Driver Score per road, per archetype, smoothest drive this month | M | S | partial (best Score per road by name, smoothest and best braking this month, this thread; per archetype todo) | Strava PRs |
| D-09 | Drive summary card worth sharing (score, map silhouette, archetype mix), no times or speeds | H | S | done (this PR: Log → Share card, a 1080×1350 picture: outline without the first and last 800 m, score, smoothness/braking/consistency, corner mix; no times, speeds or pace) | Strava activity card, Relive |
| D-10 | 3D flyover replay of a drive with the corner notes and g trace (export as a video) | H | L | done: replay → Video records the drive's replay over the map (3D with terrain on) with the pace note, speed and name drawn on it, from the start at the chosen speed, to an mp4 (Safari) or webm (`web/flyover_video.js`, MediaRecorder; frames copied in the map's render event). The file goes to the share sheet in the app (new `shareFile` bridge: a download link did nothing there, which also fixes GPX and Download my data in the app) | Relive |
| D-11 | Dashcam overlay: sync a phone/GoPro video with the drive and render g, notes and score over it | M | L | done: Log → a drive → Dashcam overlay: pick a video filmed on the drive, slide the offset until the calls line up, then Make the video: speed, a friction-circle g dot and the next corner call drawn over each frame, recorded to a new mp4/webm (`web/dashcam.js`; the sound isn't kept). On the phone only | RaceRender, Track Addict |
| D-12 | OBD-II over Bluetooth LE: throttle, brake, RPM, gear for true inputs instead of inferred ones | H | L | parked: needs an OBD-II BLE adapter to build against (ELM327 clones differ) and Bluetooth permission copy for App Review; the inferred inputs stay until then | Track Addict, RaceChrono |
| D-13 | External GNSS (10–25 Hz) support for better lines and lap timing | M | M | parked: needs an external GNSS receiver to build against (most racing ones speak their own BLE protocol); phone GPS stays | RaceChrono, Dragy |
| D-14 | Performance timing: 0–60, 60–0, quarter mile, only on a closed course with a clear warning | M | M | owner (safety stance) | Dragy |
| D-15 | Track day mode: closed circuit, start/finish line, sector splits, laps, no public-road guardrails needed | H | L | done: only on a mapped raceway (the tiles' `raceway` class under you, checked every 30 s while moving): "Start/finish here" sets the line where you are; laps end at each crossing the same way (interpolated between fixes, 20 s minimum), the first lap places sector lines at ⅓ and ⅔, the bar shows the live delta to your best lap at the same distance, laps are spoken and kept on the drive (`d.laps`, the Log lists them). On public roads no times are kept (`web/track_mode.js`) | Harry's Lap Timer, RaceChrono |
| D-16 | Fatigue cues: rising corrections, later braking and wider lines late in a long drive, suggest a break | M | M | partial (#108 post-drive; live break cue; wider lines todo) | car driver-attention systems |
| D-17 | Incident detection: a crash-level spike plus stop asks "Are you OK?" and can alert a chosen contact | H | M | done (web/incident.js: ≥6 g while moving, at rest within 15 s, still 8 s; a minute unanswered shows Call 911/112 and a text with your location to the contact, which the driver sends. Native frames carry impact_g from the 100 Hz IMU) | Apple Crash Detection, Life360, REVER |
| D-18 | Line analysis: early vs late apex per corner from the GPS line against the road geometry | M | M | partial (turn-in from lateral g vs your quicker pass, this thread; lane position needs better than phone GPS, D-13) | SOCIAL §3 |
| D-19 | Car-specific reference lap from the Garage so scores mean the same across cars | H | M | done: a drive keeps the Garage daily car it was driven in (`d.car`: label and grip); its corners are scored against that car's sane grip (`car_grip` / `Core.carGrip`, parity-tested): lifted or 2.3 t+ cars 0.52 g, winter, all-terrain or mud tyres 0.50 g, everything else the 0.60 g street default. Never higher: grippy tyres must not mean faster on a public road. The Log says which car a score is for | SOCIAL §2.4 |
| D-20 | Weekly drive digest: km of good roads, new roads, best moment, one thing to work on | M | S | done: the Log's Your week (`web/week_digest.js`): last 7 days, miles, new roads, best Score, one tip from the weakest of Smooth/Brakes/Rhythm (never pace) | Strava weekly, Whoop |
| D-21 | Coach in plain words: one sentence per drive that a non-racer understands | H | S | done (#101) | owner goal (approachable) |
| D-22 | Blank lat/lon g while the mount is `default`, like camber, so uncalibrated drives can't skew the score | M | S | done (#64 phone drives; the app's own CSV export too, this thread) | STATE 2026-10-26 |
| D-23 | Drive tags and notes (car, passenger, weather, mood) to filter the Log | L | S | done: a drive's Tags and note (presets, your own tags, a note) on its IndexedDB record; the Log filters by tag chips (`web/drive_tags.js`); never sent | Strava |
| D-24 | Driving year in review (roads, regions, best corners, crews) | M | M | partial (Log → \"2026 so far\": miles, drives, corners, months, roads you came back to, best score, longest drive, share as text; regions, best corners and crews are still to do) | Strava Year in Sport, Spotify Wrapped |

## 3. Road intelligence (Q)

Today: 5 m bins with roughness, camber, crest (#64, #65), passes-agree confidence (#87),
app-open anonymous sharing once the mount is calibrated (#71), sightline physics, rally
pace-note grammar, ALPR from DeFlock/OSM, reference-lap scoring and archetypes.

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| Q-01 | Road feel confidence: "N runs agree" / "runs differ" from per-bin spread | H | S | done (#87) | — |
| Q-02 | Bayesian hazard verification: Beta posterior with recency decay; "Confirmed" when ≥ 2 drivers agree | H | M | partial (#95: your own drives, "Confirmed on N of M"; crowd Bayesian todo) | ROAD_INTELLIGENCE §4.3, WORKER_QUEUE brand-17b |
| Q-03 | Pace-normalised corner deviation: hidden difficulty where everyone slows more than geometry predicts | H | M | owner: needs each pass's speed relative to the corner's limit in road data, and since the limit comes from public geometry that gives the speed back to a few percent: it would break the privacy page's "never speeds". Asked in OWNER_TODO | ROAD_INTELLIGENCE §4.1 |
| Q-04 | Geometry correction: crowd yaw-rate curvature overrides simplified OSM corners | H | L | done: the server keeps each bin's mean driven curvature (`k_mean`, phones always sent `k`; migration 0027, kept through a repave); where 2+ passes measured 30 m runs, it replaces the map's curvature on a planned route and its corner notes and braking envelope are worked out again (`blend_curvature` / `Core.blendCurvature`, parity-tested; `applyCrowdCurvature`, never mid-drive); the measured note says how much | ROAD_INTELLIGENCE §4.2 |
| Q-05 | Adaptive sectors by change-point detection, broken at junctions | M | M | done: `adaptive_sectors` / `Core.adaptiveSectors` (parity-tested): turning per 100 m, optimal partitioning on a mean change (penalty 2 log n × noise, floor 3°), 300 m to 2.5 km, always split at junctions (the route's turns). Each sector read by the reference lap as an archetype; the route card says "Ahead: Esses 1.4 mi at 3 mi · Switchbacks…" (`ApexRoadPage.character`) | ROAD_INTELLIGENCE §5.3 |
| Q-06 | Durable upload queue that survives page navigation and app restarts (IndexedDB) | H | M | partial (road-queue, unintegrated) | WORKER_QUEUE road-1, road-queue |
| Q-07 | End-to-end verification of open app → upload → profile → routing change on preview data | H | M | done: backend/test/loop.test.ts runs the phone's contributor and ranking against the real Worker and D1 (two members needed, retries merged once, the smooth road wins); real-phone step in VERIFY.md §0 C.16 | WORKER_QUEUE road-4 |
| Q-08 | Upload crest with the right sign and range (resolve crest semantics with the server's 0..3) | M | S | partial (#65) | ARCHITECTURE §1 |
| Q-09 | Sight offset per corner from landcover (forest vs field) instead of a constant 4 m | M | M | done for planned routes: the sightline clearance is per sample (Python and JS, parity-tested), from the map's landcover: grass, wetland, sand, rock, ice 12 m, farmland 6 m (crops grow tall), woods and unknown 4 m (`ApexStages.sightOffsets`). Checked live: Iowa farmland roads open up, the Smokies stay at 4 m. The drive exporter still uses 4 m | STATE 2026-10-25 (c) |
| Q-10 | Surface type from vibration spectrum (asphalt, chip seal, concrete joints, gravel) | H | L | parked: needs calibration drives over known surfaces before a label can be trusted (never ship guessed road data); roughness already separates smooth from broken | ROAD_INTELLIGENCE §3.4 |
| Q-11 | Wet/low-grip zones from repeated traction events and weather at the time | M | L | parked: a phone can't see traction-control or ABS events, so low-grip zones would be guesses; the forecast already warns of wet and ice (R-21) | Waze hazards |
| Q-12 | Freshness: decay old measurements, flag repaved roads when a rough road suddenly reads smooth | M | M | done: past 20 passes each new one keeps a 1/21 share (exponentially weighted mean and variance), so slow change shows; two passes in a row under half an established bin's roughness (and 0.05 g below it) restart it as repaved, with the month in `/api/roads` (`ch`) and "x km repaved Oct 2026" on the route (migration 0025; `FRESH` in contribute.ts) | Waze, ROAD_INTELLIGENCE §4.3 |
| Q-13 | Road pages: archetype, four axes, confidence L0/L1/L2, elevation, notes, verified hazards, best direction and season | H | M | partly: the reference lap is ported to JS (`referenceLap`, `windowFeatures`, `axisScores`, `archetype`, parity-tested against core/reference_lap.py); Explore → About opens a road page: archetype and the headline ("Switchbacks · 2.1 mi · climbing 800 ft"), TECH, FLOW, SURF (members' roughness), CLEAR (junctions), corners and hairpins, blind share, confidence L0/L1/L2, the better way round (`web/road_page.js`). Verified hazards and season on the page: todo | SOCIAL §2.2, Kurviger/REVER road ratings |
| Q-14 | Coverage map: which roads are measured, by how many passes, and where pioneers are needed | M | S | done: While you drive → Measured roads draws measured roads around the view, thicker the surer (the API sends a confidence level, never a count: `conf` 1 one pass, 2 two to four, 3 five or more); blank = waiting for a pioneer. Contributions carry the way's public OSM line (≤64 points, length checked against the bins), kept once in `road_ways` (migration 0023); `GET /api/coverage?bbox=` (≤0.5°, members, Z-08 rule) (`web/coverage.js`) | Strava heatmap, Mapillary coverage |
| Q-15 | Hazard reports by hand (one tap: pothole, gravel, debris, animal, police, closure) with auto-expiry | H | M | done (this PR: Report key in the drive bar, six kinds, expiry by kind, nearby reports pinned and called ahead in your direction; migration 0011) | Waze |
| Q-16 | "Still there?" prompts when you pass a reported hazard, to confirm or clear it | M | S | done (this PR: after passing one in your direction, 'still there?' with Still there / Gone; two 'gone' outvoting confirmations end it) | Waze |
| Q-17 | Road closure and construction from OSM and crowd reports, fed into routing | M | M | partial (reported \"Road closed\" hazards within the trip's box go to the router as exclude_locations; no way around: routed anyway with a warning. OSM construction tags still to do) | Waze, Google Maps |
| Q-18 | Native C++ core (`/core/cpp`) so iOS and Android share one implementation instead of Swift duplication | M | XL | parked (XL): a C++ core shared by iOS and Android; Android is low priority (owner 2026-10-25), and the Swift live pipeline is parity-tested against Python today | ARCHITECTURE, STATE 2026-10-25 |
| Q-19 | Benchmark road calibration set scored from map + DEM, checked in CI | M | M | done (map; DEM not yet): the benchmark set above, checked in CI on every PR | ROAD_INTELLIGENCE §6.2 |
| Q-20 | Archetypes by clustering once crowd data exists | M | L | parked: needs enough crowd data to cluster; archetypes are rule-based (reference lap) until then | ROAD_INTELLIGENCE §5.2 |
| Q-21 | Real device acceptance for app-open sharing (shared km matches driven km, minus private ends) | H | S | owner (phone) | STATE 2026-10-27 |
| Q-22 | "Pothole ahead" from your own confirmed hazards on any road, with no route loaded | H | S | done (#104) | thread Deepen driver and road analysis |
| Q-23 | Bundled demo drives (tools/export_web_profile.py via core/kinematics.py `profile_drive_dataframe`) write camber 0.0 for every 5 m bin with no cornering (`fillna(0.0)`), so straights read as measured flat. Keep NaN, export null, re-export web/data | M | S | done (thread Deepen driver and road analysis) | audit 2026-10-28 (CLAUDE.md rule 3) |

## 4. Co-driver and pace notes (V)

Today: rally grammar (McRae 1–6, caution ladder, chaining), Kokoro voice banks, Jarvis,
adaptive notes (cruise vs spirited), car audio routing to Bluetooth/CarPlay (#73).

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| V-01 | Note timing from your speed and reaction, not a fixed ~5 s; learned per driver | H | M | done (this PR: lead = time to say the note + your reaction + braking from your speed to the corner's at 0.35 g, 60–600 m; reaction learned from when you brake after a call, kept on the phone) | rally co-drivers |
| V-02 | Note density levels a novice understands ("gentle left" vs "left 4 minus") | H | M | done (this PR: Settings → Voice → Plain words / Rally notes; plain is the default for new installs, saved settings keep rally; same notes, plain wording, spoken whole) | owner goal (approachable) |
| V-03 | Hazard speech always pre-empts ordinary notes, never stale, never duplicated | H | S | done (this PR: web/speech_queue.js; hazards first and cut off an ordinary line, passed or old lines dropped, keyed lines never twice; the app gets one line at a time) | WORKER_QUEUE convoy-2 |
| V-04 | Turn-by-turn and pace notes in one voice stream so transit directions never collide with notes | H | M | done (web/directions.js: the router's junctions spoken early and at the turn, "then" for a turn right after, roundabout exits, arrival; the call at the turn goes ahead of corner notes and a corner note at a junction is left out) | Waze/Google voice |
| V-05 | Phrases in the owner's voice (voice conversion), behind licences | M | L | owner (voice on hold) | docs/VOICE.md |
| V-06 | Celebrity/character voice packs as cosmetic Octane rewards | M | M | parked: celebrity voices need licences (money, owner); character packs need a pre-rendered bank per voice (several MB each, and the live engine isn't allowed in the iOS app, 2.5.2). The Octane shop (S-10) is ready to sell them as cosmetics once a bank exists | Waze voice packs |
| V-07 | Voice commands: "report pothole", "skip this stage", "how far to the next stage" (Siri Shortcuts first) | M | M | done: Siri and Shortcuts (`ApexIntents.swift`): "Start a drive / Report a hazard / End my drive in Vetta", through the app's own links; report and end only during a drive. "How far to the next stage" says it aloud (or how much of this one is left) and "Skip this stage" drops the stage you're on or the next one and reroutes, keeping your stops: a fun route keeps where its stages are (`FunRoute.stageSpans`, placed again after a reroute) |
| V-08 | Music ducking tuned per note priority; never duck for low-priority notes in cruise | L | S | done: `ApexSpeechQueue.ducks`: hazards, pace notes, directions, lines you asked for and anything spirited duck; route and traffic phrases in cruise play over the music (`.mixWithOthers` in the shell) | — |
| V-09 | Recce mode: drive slowly once, the co-driver writes your own notes for the road and reads them next time | H | L | done: a drive's page → Your notes: keep its calls as yours, change any call, forget them (`web/recce.js`); routes and drives over those corners in the same direction (30 m, ±60°) read your calls (rally words; plain words still come from the map) | rally recce |
| V-10 | Remove espeak-ng (GPL) from the voice path before charging | M | M | done: kokoro-js (which inlines espeak-ng) is not loaded; text becomes phonemes in `web/g2p.js` (misaki's dictionaries and its Apache-2.0 fallback model); docs/VOICE.md "Removing espeak-ng (GPL)", tests/test_g2p.py. Audio the bank was rendered with isn't covered by the tool's licence | docs/VOICE.md |
| V-11 | Notes are due at the corner's entry (turn-in), not its apex: countdown, spoken call, lead distance and staleness all measure to `start_m` | H | S | done (this PR) | owner 2026-10-28 |

## 5. Social and community (S)

Today: accounts with Google sign-in, friends, crews (public and private, crews near you)
(#76), Board with Friends/crew filters (#48), opt-in segment time sharing, highlights
(#61), Octane points per contributed km, convoy server (#84).

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| S-01 | Crews as groups: public/private, nearby discovery, tiles, owner settings | H | M | done (#76) | Strava clubs, REVER groups |
| S-02 | Convoy client: create/join by code or QR, live positions, gap in time, leader hazard calls, regroup | H | L | done (#84, #89) | WORKER_QUEUE convoy-1..3, REVER, Waze |
| S-03 | Friends' activity in the Log with rank on shared stages | H | M | done (Log → Friends lately: GET /api/board/activity, the board's visibility rules, your rank on each stage, scores only) | WORKER_QUEUE log-friends, Strava feed |
| S-04 | Garage: car profile (mass, power, tyres, ride height), shareable car cards, no location | H | M | done (#98; ride height and grip numbers not yet) | SOCIAL §2.4, Drivetribe |
| S-05 | Share a planned route (geometry + notes) to a friend or crew, never a recorded drive | H | M | done (this PR: Share on the route card to friends and crews, the shape without the first 400 m, 30 days; Crew → Routes shared with you → Open rebuilds the notes; migration 0012) | SOCIAL §2.5, Calimoto, Roadtrippers |
| S-06 | Crew events: a planned drive with time, meeting point, route, RSVPs and a convoy that opens on the day | H | L | done (Crew → Crew drives: plan one for a crew with a meeting point and the planned route, going / maybe / can't, directions to meet, add to calendar, report; the planner's "Start the convoy" from 2 h before invites everyone going. Migration 0013) | Meetup, REVER rides, car clubs |
| S-07 | Kudos and comments on shared drives and highlights | M | M | done (kudos; comments dropped): a Kudos button on friends' runs in the Log (`POST/DELETE /api/kudos`, migration 0018), "Kudos for you" list; only on runs you can see, blocks hide them. Comments left out on purpose (moderation, harassment); highlights already take ratings | Strava kudos |
| S-08 | Local legends without speed: most passes of a stage this month, smoothest crew | M | S | done: legends: the board's `days_month`, and "Local legend this month" = most different days (3+), never the fastest (`web/legends.js`; the Log now publishes each recent day's best once). smoothest crew: Crew → Crews this month ranks public crews of 3+ by the mean Smooth of runs published to them this month (3+ runs; `board_entries.smoothness`, migration 0026, `web/crew_standings.js`) | Strava Local Legends |
| S-09 | Pioneer badges for first measured passes of a road (3× Octane already designed) | M | S | done: counted when the first/second slot is claimed (migration 0019), "Pioneer of N roads · second to map M" under You in Crew; only you see yours (who was first stays hidden) | SOCIAL §2.3, Waze points |
| S-10 | Octane redemptions that buy nothing safety-related: cosmetics, voice packs, early features | M | M | done: Settings → Look: cockpit accents (Rally blue 40, Racing green 80, Ink 150 Octane) bought with earned Octane only (`/api/shop`, `/api/redeem`, migration 0028; prices on the server, one atomic insert so two at once can't overspend). They recolour the route line and accent; warnings keep their colour. Never a safety feature or a score | SOCIAL §2.3 |
| S-11 | Challenges: "drive 5 new roads this month", "pioneer 10 km", crew-vs-crew km | M | M | done: the Log's monthly challenges (5 new roads, 3 smooth drives, 200 scored corners; `web/challenges.js`). pioneer km ("be first to map 10 km", from the server's `member_months`, migration 0026) and crew-vs-crew road data km this month in Crew → Crews this month (`GET /api/crews/standings`; crew totals only, private crews never ranked) | Strava challenges, REVER |
| S-12 | Highlights feed near you: viewpoints, cafés, meets, saved by members | M | M | done: Crew → Spots near you (`web/spots_feed.js`): members' spots best rated then nearest, category chips, Go there, 1/3/5★, Report; meets are S-13 | Roadtrippers, Google Maps contributions |
| S-13 | Car meets map: public events and recurring Cars & Coffee, added by crews | H | M | partial (a public crew lists a drive as a meet; Crew → Meets near you within 80 km, join the crew to answer; migration 0015. Recurring meets and pins on the map are still to do) | car meet apps, Facebook groups |
| S-14 | Invite links that open the app (or the web) on the crew or route | H | S | done (custom scheme; Universal Links later) | growth |
| S-15 | Profiles: handle, cars, crews, favourite roads, totals; private by default | M | M | done: Friends → Profile (`GET /api/friends/:id/profile`, `web/profile_view.js`): accepted friends only, made only of what they already share with you (cars shown to friends, crews in common, stages scored to you with best score and days this month); never times | Strava profile |
| S-16 | Block and report on every social surface; moderation queue for public crews and highlights | H | M | done (#120) | App Store requirement for UGC |
| S-17 | Pairwise "which road was better?" after a drive feeds road scores (and is fun) | M | S | done on the phone: a drive asks "which was better?" against your last other road; Elo per road gives the Log's Your roads (`web/road_votes.js`). Feeding the crowd road scores needs the server: R-33 | SOCIAL §2.2 |
| S-18 | Photos on highlights and stops, stripped of EXIF location beyond the highlight | M | M | partial: a photo on your own spots, redrawn without EXIF (GPS, time, camera), max 1600 px, on the phone only (web/spot_photos.js); Erase clears it. Shared photos need image storage and photo moderation (1.2): owner decision in OWNER_TODO | Roadtrippers, Google Maps |
| S-19 | Live share ETA with a friend or family ("Nate is 12 min away") without sharing the drive | M | M | done (route card → Share ETA: a link to web/eta.html with the handle, minutes left and arrival time, refreshed each minute while driving, ended on arrival or Stop; no position, route or destination; migration 0016) | Apple Maps Share ETA, Life360 |
| S-20 | Flyby: after a drive, see which friends drove the same road that day (opt-in) | L | M | done: a drive's page lists friends who posted a score on its stages that day (`web/flyby.js`, from `/api/board/activity`: their board sharing is the opt-in; marked stages only, 14 days) | Strava Flyby |
| S-21 | Garage cars from a vehicle database: pick year, make, model and trim, specs (power, weight, drive, gearbox) fill in, and you only change what differs (colour, mods, tyres). Free source: NHTSA vPIC (makes/models/years, VIN decode, US-only, no power/weight) plus a curated spec table for enthusiast cars | H | M | partial (this PR: VIN decode and model suggestions from NHTSA vPIC, typical specs for 31 enthusiast cars incl. weight; a bigger spec table todo) | owner 2026-10-28 |
| S-22 | Convoys without copy-paste links or a website: invite friends and crew-mates from inside the app (they get the invite in the app), a short join code to read out, and a QR code to scan in the car park | H | M | partial (this PR: in-app invites to friends and private crew-mates, Join from the Crew sheet, a toast when one arrives, and a QR code of the link for the car park; a short spoken join code todo) | owner 2026-10-28 |

## 6. UI and UX (U)

Today: Road book as the one theme with day/night (#56, #62), Night Auto by sunset (#46),
Plan as a pull-up sheet (#70, #73), Settings tab, drive switches on the map edge,
accessible switches and focus (#81), honest empty states (#79), drive detail (#83).

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| U-01 | Plan as a sheet over the map with recent places and saved spots | H | M | done (#70, #73) | Apple Maps |
| U-02 | Hide the Where to?/Start bar during a replay; it covers the cluster | M | S | done (#90) | STATE 2026-10-28 UI audit |
| U-03 | Crew sheet draws one rule under its title, not two | L | S | done (this PR) | STATE 2026-10-28 UI audit |
| U-04 | Imported drives get a real name (place, road, time of day), not the file name | M | S | partial (recorded drives are named after their main road, from map tiles on the phone; imports still read "Drive date time") | STATE 2026-10-28 UI audit |
| U-05 | Audit the cockpit with simulated GPS frames on six phone shapes (15 Pro, 15 Pro Max, 13 mini, SE, and the two landscapes), day and night, with the hardware drawn on top | H | S | partial (the browser track exists; the six shapes were captured for docs/design/REVIEW2.md and should be a CI artefact) | STATE 2026-10-28 UI audit |
| U-06 | Stages simplified: one list near you with your best and the leader, create from a drive in one step | H | M | partial (#77) | WORKER_QUEUE stages-1 |
| U-07 | Glanceable cockpit: one number and one note readable at arm's length in sunlight | H | M | partial (drive bar: big Rec mileage, problems only; lead pace note 32 px distance, 21 px call, 56 px tulip) | car HMI guidelines |
| U-08 | Motion design pass: route reveal, sheet springs, note transitions, under 200 ms, reduced-motion respected | M | M | partial (pace notes slide on in 160 ms when one is passed) | Apple Maps |
| U-09 | Haptics on notes and hazards (subtle, configurable) | M | S | done (this PR: a light tap on each pace note, a warning pattern on hazards, via the shell's Taptic Engine; Haptics switch, on by default) | Apple Maps turn haptics on Watch |
| U-10 | Home screen and lock screen widgets: nearby best stage, last drive score, crew event | M | M | partial (a Start-a-drive widget for the home and lock screen and a Control Center button on iOS 18, opening apexnav://open?go=drive; widgets with data (last score, next crew drive) need an App Group) | iOS widgets |
| U-11 | Live Activity / Dynamic Island: next note, distance to stage, ETA | H | M | done (ApexNavLive widget extension; #240 brought the island presentations to the HIG, U-35) | Apple Maps, Uber |
| U-12 | Apple Watch: next note as a tap on the wrist, drive summary | M | L | owner: a watchOS app is a third target with its own bundle id and signing; worth it after CarPlay (C-01). Asked in OWNER_TODO | Apple Maps on Watch |
| U-13 | Map style polish: road character colours (twist, surface) as an optional layer | H | M | partial: Twisty roads switch (map shape); surface todo | Kurviger curvy colours, Calimoto |
| U-14 | 3D terrain with hillshade on the planning map and flyover preview of a route | M | M | done: map panel → 3D terrain raises the hillshade's DEM into relief (×1.4) and tilts the map; Preview then flies the route over it. Off by default and off while saving battery | Apple Maps, Google Earth |
| U-15 | Dynamic Type and VoiceOver pass on every screen, checked with the iOS simulator | H | M | partial: sheets, Log and Stages follow the text size (up to 1.6x); replay scrubber is a slider; not run in the simulator | accessibility |
| U-16 | Landscape cockpit layout for mounts in landscape | M | M | partial: the landscape cockpit exists; #240 fixed the tab rail in the corner, Tapedeck overprinting and the replay rail scrolling away; the plan sheet on its side is still one column (U-23) | Waze |
| U-17 | Copy pass to BRAND voice on every remaining string (errors, empty states, permissions) | M | S | partial (#103) | docs/BRAND.md §2 |
| U-18 | Replace the remaining browser controls with the app's own: `<select>` (Stages drive picker, Compare's A/B, the crew list's privacy), `<input type=file>` (Dashcam overlay, Import a drive, Add photo) behind an ink key, `<input type=range>` (Dashcam offset, Corner mix) as the balance slider, the grey text inputs (Start from, New crew name) as rows | H | M | partial (Roadmap 2 item 12: the drive page, Stages and Compare; the selects on forms remain) | STATE 2026-10-27 |
| U-19 | Search that understands roads and stages ("Tail of the Dragon"), not just addresses | H | M | done: Where to? matches your stages and spots by name first (any word order, accents ignored, works offline), and map search drops roads you can't drive (cycleways, paths, footways) so a road name finds the road (`web/place_search.js`). Famous roads with no OSM name for the nickname still need a stage: todo |
| U-20 | Saved places and lists (home, work, favourite stages) synced to the account | M | M | done on the phone: route card → Pin place (Home, Work or any name), first in Where to? with Unpin (`web/pinned_places.js`). Deliberately not synced: a home address never goes to the server; stages already sync | Google Maps lists |
| U-21 | Route preview: scrub along the route with elevation, notes and road character | M | M | done: Preview already scrubs with notes and the sector's character; a planned route now gets its elevation from the DEM (`ApexStages.profile`, every 60 m, ≤48 tiles) for the scrubber's hills and a "Climbs 1,200 ft · 1,400 to 5,050 ft" card line; long trips or no tiles: unknown. Checked live: Gatlinburg 424 m → Newfound Gap 1,539 m | Calimoto, Komoot |
| U-22 | Units and locale: km/mi, 12/24 h, left-hand traffic notes | M | M | done: units: Settings → Units (`web/units.js`, miles by default for en-US/en-GB, km elsewhere) across the cockpit (notes, dial in km/h, trip), planning (cards, toasts, 25/50/75 km loops), spoken directions and convoy calls, the Log (drive view, charts, compare, stages, year and week), share cards and fuel gaps. Physics stays SI. Dates and 12/24 h already follow the phone; driving side (`web/driving_side.js`, from coarse boxes around the left-hand-traffic countries, or Settings → Units): sight distance gives bends toward your own side 0.8 m less clearance (Python and JS, parity-tested), so a UK left-hander or a US right-hander is the more cautious call; never more sight than before |
| U-23 | Safe-area pass on landscape and 375 pt phones: section 1 rows 1 to 22 of REVIEW2.md (onboarding, drive-ended, hazard report and confirm clear the home indicator; tab rail inset from the corner and hidden under overlays; Layers panel anchored above the deck and above the loop plate; legal and about pages padded; notes strip gutter; hazard call nowrap). Extend `e2e/smoke.js` "safe areas" with mini and SE, the eleven missing screens, a corner test, an overlap test and a gap test | H | S | done (rows 1 to 22; the e2e flow adds overlap and gap tests) | REVIEW2.md §1, owner 2026-10-29 |
| U-24 | Sticky headers and footers never show half-cut content: a 16 px paper fade under every sticky header and above the plan sheet's Find bar; the sheet body reserves the bar's height | M | S | partial (#240: fades under sheet headers and above Find a loop; the plan body scroll-padding) | REVIEW2.md §1 rows 15, 16 |
| U-25 | Photo viewer as a full-screen lightbox appended to `body`: black, safe-area padded, the action bar at the bottom, tap outside closes | M | S | done (#240) | REVIEW2.md §1 row 10 |
| U-26 | Legal pages (privacy, terms, licences) and About on the app's tokens: paper, Inter Tight, ink links, a "‹ Garage" row, the draft banner as a rule. About inside the app is a Garage row, not the landing page | M | S | done (Roadmap 2 item 4: app tokens, ‹ Garage, About in the Garage) | REVIEW2.md §2 |
| U-27 | One landscape chrome: the Log gets the right-hand tab rail the other tabs have; the active mark on the rail's edge; the rail outside the binnacle's scroller so it never scrolls away | M | S | done | REVIEW2.md §1 rows 2, 7 |
| U-28 | Tapedeck's landscape binnacle: bar meters under the readouts, never over them | H | S | done (#240) | REVIEW2.md §1 row 6 (bug) |
| U-29 | Billet's trip drum tenths digit renders as a blank red block | M | S | done (#240) | REVIEW2.md §2 Replay Billet (bug) |
| U-30 | The old crew list under the crew page becomes a Crew settings sheet behind a gear key (members, invite links, public/private, leave, create); Routes shared and Spots become rows on the page | H | M | done (Roadmap 2 item 13) | REVIEW2.md §2 Crew page lower, REVIEW.md 3.3 |
| U-31 | Plan sheet: one loop control (the dial with five drawn detents and the value in its face), no chips, no helper sentences | M | S | done (Roadmap 2 item 11) | REVIEW2.md §2 Plan sheet, mockup 02 |
| U-32 | Log index: hero, one quiet summary row, then the drive list with a corner-density sparkline per row; Your week as the list's first row | M | M | done (Roadmap 2 item 14) | REVIEW.md roadmap 13, REVIEW2.md §2 Log |
| U-33 | Empty states as one line and one action, never a bordered box (Stages, Crews near you, Spots near you, Routes shared) | M | S | partial (Roadmap 2 item 14: the Log and Stages; Crews and Spots near you still explain in a line) | REVIEW.md 1.1 (7), REVIEW2.md §2 |
| U-34 | The score placeholder "--" drawn in the numeral font at the score's size, not as two filled bars (drive-ended card, Log hero, drive detail) | L | S | done (Roadmap 2 item 15) | REVIEW2.md §2 |
| U-35 | Live Activity to the HIG: compact trailing shows the tulip and a short call ("R1+"), minimal shows a glyph only, expanded regions get 10 pt margins and a two-line note, a hazard turns the keyline and triangle signal orange | M | S | done (#240: short call, glyph minimal, 10 pt margins, two-line note, hazard keyline orange) | REVIEW2.md §1 Live Activity |
| U-36 | Night as a mode on the binnacle: larger speed numeral, Limit and Sight on one row, the trip readout hidden until tapped | M | M | done (Roadmap 2 item 19) | REVIEW.md roadmap 11 remainder |
| U-37 | Capture stubs for every mockup surface in `tools/app_tour.js`: a routed route with corners, profile and alternatives; two friends and a home zone on the map; the Plan a drive form open; the crew board and chat; a Tapedeck drive, not only a replay | M | S | done (Roadmap 2 item 20) | REVIEW2.md §2 (Route card, Friends on the map, Plan a drive) |
| U-38 | Kit redrawn at 80 px on a 16 x 14 grid with two idle frames and the four lean frames wired to the call's direction; the "KIT SAYS" line wraps to two | M | M | done (Roadmap 2 item 18) | REVIEW.md 4.1, REVIEW2.md §3 |
| U-39 | The Pro-trial banner leaves the map (the hazard plate's place) for the status line: "Tapedeck · 9:40 left · Stop" | L | S | done | REVIEW2.md §2 Replay Tapedeck |
| U-40 | The Limit readout as the white US sign (theme contract 4.3.5): 44 x 52 px, black border, SPEED LIMIT in 7 px caps | M | S | done (Roadmap 2 item 16) | REVIEW.md 4.3 |
| U-41 | "1,240 points" in the Garage header: remove, or name the unit | L | S | done (Roadmap 2 item 15) | REVIEW2.md §2 Garage |
| U-42 | Works stickers carry the supporter's initial in the stripe colour, not a count | L | S | done (Roadmap 2 item 15) | REVIEW2.md §2 Crew Works livery |
| U-43 | Shared ETA page never prints NaN or Invalid Date: "This link has ended", or "--" | M | S | done (#240) | REVIEW2.md §2 (honesty rule) |
| U-44 | The slide switch component: 44 x 24 track, 20 px thumb with travel and a 2 px drop, used in Layers, Garage and Friends in place of the 36 x 20 toggle | M | S | done (Roadmap 2 item 10) | REVIEW.md 2.1, REVIEW2.md §2 Layers |
| U-45 | Replay controls as one slide switch (Pause / Play) and a speed detent; the elevation thumbnail as a full-width scrubber; the tab bar hidden during replay as during a drive | M | S | done (Roadmap 2 item 17) | REVIEW2.md §2 Replay Roadbook |
| U-46 | Chat and names render emoji as text (strip or replace); a test over the crew chat and build replies | L | S | todo | REVIEW.md "Not doing", brief |

## 7. Onboarding and growth (O)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| O-01 | First run in three screens max, permissions at the moment of need | H | S | done (BRAND §4; polish: no focus ring, Sign in is the one solid button on its step) | docs/BRAND.md §4 |
| O-02 | Mount guide: how and where to mount the phone, with a live "calibrated" tick | H | S | done (app: Mount row before the first drive, "Mount set" when calibration locks) | STATE 2026-10-26 calibration |
| O-03 | Instant value with no account: plan a fun loop from where you are in two taps | H | S | done (loop chips in Where to?) | Calimoto |
| O-04 | Demo replay that shows the cockpit, notes and analysis in 60 s | M | S | partial (#58) | — |
| O-05 | Sign in with Apple (required on iOS when Google sign-in is offered): native provider in the shell, Worker verifies the token, capability enabled through the API key (docs/APP_REVIEW.md) | H | M | partial (this PR: native sheet, Worker verification, entitlement, capability on the App ID; token revocation on account deletion needs the owner's Sign in with Apple key) | App Store guideline 4.8 |
| O-06 | Email link sign-in as a no-Google option | M | S | owner: needs an email sender (a domain on Cloudflare Email Sending or a provider), which costs set-up the owner has to do; asked in OWNER_TODO | docs/BACKEND.md |
| O-07 | Referral: invite a friend into your crew, both get Octane | M | S | done: someone who joined on your invite earns you both 5 Octane on their first accepted road data, once (migration 0020; paid on real data so throwaway accounts earn nothing); the invite toast says so | Waze, Strava |
| O-08 | Landing page with real screenshots, the four promises and TestFlight/Play links | H | S | partial (web/about.html: the pitch, two real screenshots from tools/landing_shots.js, the four promises, what it does, links to the app, a replay, privacy, terms and licences; the public TestFlight link and a contact address wait on the owner; no Play app yet) | launch |
| O-09 | App Store listing: screenshots, preview video, privacy nutrition label, keywords | H | M | partial (text, keywords, age rating and App Privacy answers drafted in docs/LISTING.md; the owner pastes them; screenshots to come) | launch |
| O-10 | In-app "what's new" sheet after an update, one screen | L | S | done (web/whats_new.js: once per release, not on a first install or over a link; edit NEWS and its id when a release adds something drivers notice) | — |
| O-11 | Privacy policy and terms of use pages, linked in Settings and at sign-in, policy URL in App Store Connect; terms carry the no-tolerance rule for objectionable content (guideline 1.2). Drafted from the real data flows, owner approves (Z-07) | H | S | partial (this PR: pages drafted and linked; owner approves the text and the contact line, then the URL goes into App Store Connect) | App Store guidelines 5.1.1(i), 1.2 |
| O-12 | App Review access: a reviewer sign-in path that needs no invite, and review notes (drives need a car; replays show the cockpit) | H | S | partial (this PR: a long-lived review code, only its hash in the repo, makes a reviewer's account a member; the owner pastes the code and notes into App Store Connect) | App Store guideline 2.1 |
| O-13 | Native surfaces that make the app more than a web view (Live Activity, widgets, CarPlay) named in the review notes | M | M | partial (Live Activity, a Start-a-drive widget and Control Center button shipped; CarPlay to come) | App Store guideline 4.2 |

## 8. CarPlay, Android Auto and in-car (C)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| C-01 | CarPlay map template with route, next note and ETA | H | L | owner (CarPlay entitlement): request answers, the guide's requirements and the build plan are in docs/CARPLAY.md; pre-request fixes done (promptStyle, listing leads with navigation) | Vetta mission |
| C-02 | CarPlay notes as a list template and hazard alerts as CPAlert | H | M | owner (Apple account) | Waze CarPlay |
| C-03 | Android Auto navigation template | H | L | owner (Android priority) | Vetta mission |
| C-04 | Car audio: ducking and routing to Bluetooth/CarPlay while prompts play | H | M | done (#73) | — |
| C-05 | Auto-start: open the cockpit when the phone joins the car's Bluetooth or CarPlay | M | S | done (#152): CarPlay audio route offers "Start drive"; `apexnav://open?go=drive` starts one (Shortcuts automation "When CarPlay connects"). Not yet checked in a car | Waze, Shortcuts |
| C-06 | Driving focus aware: no social notifications while driving, a summary after | M | S | blocked: the app sends no notifications yet; build this with the first push or social alert | iOS Focus |
| C-07 | Big-target in-car mode: every control ≥ 60 pt, no keyboard while moving | H | S | done (#121) | NHTSA distraction guidelines |
| C-08 | Passenger mode: unlocks typing and route editing while moving, with a clear switch | M | S | done (#121) | Waze passenger prompt |

## 9. Offline (F)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| F-01 | Honest offline states everywhere (`--`, "no signal to reroute") | H | S | done (#34, #67) | honesty rule |
| F-02 | Offline region downloads: vector tiles, DEM and road profiles for an area | H | L | done: Settings → Your data → Save the map here keeps the style, its data description, label fonts, map tiles z8-14 and terrain z10-12 for 25 km round the map's centre (less when over 2,500 tiles) in IndexedDB (`web/offline_tiles.js`). Map requests go through an `apexc://` MapLibre protocol: a saved copy first, else the network; stage discovery, landcover and the DEM read saved copies too, so the map, loops, Explore and climbs work there with no signal. Areas listed with size and Delete. Members' road profiles offline: todo | Google Maps offline, Calimoto |
| F-03 | Save a planned route for offline: geometry, notes, hazards and profiles cached before leaving | H | M | partial (web/saved_routes.js: Save on the route card keeps shape, directions, router times and limits; Where to? lists it and it opens with no signal, notes worked out on the phone. The planned route also survives an app restart for 12 h. Map tiles need F-02; reported hazards are live only) | Calimoto, Kurviger |
| F-04 | Offline rerouting with on-device Valhalla (see R-28) | H | XL | parked with R-28 (on-device Valhalla) | ROAD_INTELLIGENCE §7.4 |
| F-05 | Queue hazard reports and road data offline, send on reconnect (see Q-06) | H | M | partial (hazard reports and "still there?" answers: web/outbox.js keeps them on the phone, sends on reconnect with age_s so they expire from when they were seen; road data retries within a drive, surviving a restart is Q-06) | Waze |
| F-06 | Cache size control and "delete offline data" in Settings | L | S | done: Settings → Your data says saved routes, downloaded voices and the app's total storage (unknown stays unsaid) and deletes the offline part; map tiles are the web cache's (MapLibre 4 keeps none) | — |

## 10. Reliability and observability (Y)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| Y-01 | Route loading never hangs; black-screen recovery | H | M | done (#67) | owner report |
| Y-02 | Crash and error reporting without personal data (self-hosted Worker endpoint, no third-party SDK) | H | M | done (#117) | production readiness |
| Y-03 | Client health beacons: upload success rate, routing failures, calibration time, anonymous and aggregated | H | M | done (web/health.js + POST /api/app-health, migration 0014: yesterday's totals, anonymous, once a day, switch in Settings → Your data; owner rates in Crew) | production readiness |
| Y-04 | Production router: self-host Valhalla or a paid tier instead of public demo servers | H | L | owner (cost) | STATE 2026-10-25 (d) |
| Y-05 | Status page and synthetic checks for the Worker, D1 and routing | M | S | done (#141) | production readiness |
| Y-06 | Staged rollouts: preview Worker for TestFlight, feature flags per build | M | M | done: `GET /api/flags` (backend/src/flags.ts): flags by minimum build (from the app's user agent), platform, or a share of installs (a stable bucket from a random install id), overridable without a release by the `FLAGS` variable; the newest features (track mode, taste ranking, crowd curvature) ship with kill switches. The phone caches the answer 6 h and keeps shipped defaults offline (`web/flags.js`). A separate preview Worker for TestFlight isn't possible: a TestFlight build is the App Store binary | docs/BACKEND.md |
| Y-07 | Real-phone test checklist run before each TestFlight build (VERIFY.md) | H | S | done (VERIFY.md section 0; first run is the owner's) | docs/VERIFY.md |
| Y-08 | Record migrations in `d1_migrations` and a drift check in CI | M | S | half (backfilled 0001–0009 on both databases 2026-10-28; CI drift check todo) | STATE 2026-10-26 |
| Y-09 | Database backups (D1 time travel/export) and a restore drill | H | S | done (#124; first export 2026-10-28 via the connector; drill needs the owner's wrangler login) | production readiness |
| Y-10 | Rate limits and abuse protection on every write endpoint | H | M | done (#112) | production readiness |
| Y-12 | Scheduled backups with no token: a Worker Cron Trigger (Mondays 07:00 UTC) dumps every table through the D1 binding into the private `apexnav-backups` KV namespace, keeps the last 8 (docs/BACKUPS.md section 3a). Move to R2 once the owner enables it or a dump nears 24 MiB | H | S | done (this PR; first run the Monday after deploy) | first backup 2026-10-28 |
| Y-11 | End-to-end browser tests of the main flows (plan, drive replay, log, crew) in CI | M | M | done (#148, routed plan stubbed in a follow-up): first run + replay, live cockpit + typing lock, battery saver, search offline, a stubbed routed plan, Log; Crew needs a stubbed Worker API (next) | testing |
| Y-13 | No cron: expired invites, crew invites and app sign-in codes stay in D1 forever (sessions are now swept on the next sign-in, #132). A daily `scheduled` handler that deletes expired rows (can share the Y-12 backup cron) | L | S | done (this PR: daily cron `23 6 * * *`, src/sweep.ts; used account invites kept) | audit 2026-10-28 |
| Y-14 | Segment ids are client-made (`seg_<ms>`) and global: two people saving at the same millisecond get `409 id_taken` and that segment never syncs. Scope ids per owner, or let the server assign and return one | L | S | done: ids are `seg_<ms>_<48 random bits>` (`ApexSync.newSegmentId`); an old id someone else holds gets a fresh one on 409 and is sent again | audit 2026-10-28 |
| Y-15 | `upsertGoogleUser` never refreshes email or display name for an existing account, so a changed Google address stays stale in the export and in `OWNER_EMAIL` matching | L | S | done (this PR: every sign-in takes Google's current email and name) | audit 2026-10-28 |
| Y-16 | Owner screen for crash counts (reads `GET /api/ops/errors`; today only JSON) | M | S | done (this PR: Crew → Errors this week for the owner: count, source, route or page, days, last seen, stack) | crash-log review 2026-10-28 |
| Y-17 | Latency and real error rate where agents can read them: Analytics SQL binding (`logs.workersLogs`, beta) or a daily summary row in D1; or sign in the full Cloudflare connector | H | M | done: `route_stats` in D1 (migration 0021) per day and route pattern: requests (sampled 1 in 10, weighted), 4xx, exact 5xx, mean and bucketed latency; owner reads `GET /api/ops/latency` (Crew → Server this week), agents read D1 |
| Y-18 | Count Durable Object (convoy) exceptions in `error_counts` too; today only the Worker's route handler 500s are counted | M | S | done (this PR: convoy socket-frame and alarm failures counted as 'convoy frame' / 'convoy alarm', scrubbed like the rest) | crash-log review 2026-10-28 |

## 11. Performance and battery (P)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| P-01 | Battery budget for an hour of driving with screen on, measured and published | H | M | partial: each drive measures its battery cost (iOS frames, browser getBattery), shown in the Log and My data; publishing a figure needs an owner hour drive on TestFlight (OWNER_TODO) | Waze, REVER complaints |
| P-02 | Low-power cockpit: drop to 30 fps and fewer map layers when the battery is low or hot | M | M | done (#133) | thermal throttling |
| P-03 | Split web/index.html into modules so pages load faster and threads stop colliding | M | L | todo | dev velocity |
| P-04 | Lazy-load voice banks and kokoro-js only when voice is on | M | S | done (already lazy: checked 2026-10-28, a cold start fetches only voices/index.json) | startup time |
| P-05 | Route analysis in a Web Worker so the UI never stutters while scoring | M | M | done: a planned route's curvature, sight distance (~0.1 s per 100 km on a laptop, several times that on a phone), braking envelope and corners run in `web/analysis_worker.js` (`ApexAnalysis.analyse`); no worker, an error or 15 s without an answer runs the same calls inline, and tests check both give the same result. Stage discovery already yields every 8 ms | Y-01 |
| P-06 | Startup under 1 s to an interactive map on a mid-range phone | H | M | partial (demo drives load on demand, #125) | — |
| P-07 | Thermal guard: pause the 100 Hz pipeline gracefully if the phone overheats on the dash | M | S | done (#128) | iPhone on windscreen |

## 12. Privacy and security (Z)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| Z-01 | First and last km of every trip never leave the phone; trips cut on stops and gaps | H | M | done (#71; random 0.5–1.5 km per trip end since #139) | docs/SOCIAL.md §1 |
| Z-02 | Privacy zones you draw (home, work) where nothing is ever recorded or shared | H | S | done (this PR: Settings → Privacy zones, 200 m/500 m/1 km circles at your position or the map centre, phone only; inside: no drive samples, road data stops, convoys get no position) | Strava privacy zones |
| Z-03 | Privacy dashboard: what's on the phone, what was shared, delete my account and data | H | M | done (this PR: Settings → Your data: what the phone holds and whether anything is on the server, download account data, delete drives, erase everything on this phone; account deletion stays in Crew) | GDPR/CCPA, App Store 5.1.1(v) |
| Z-04 | Data export (drives as CSV/GPX, account JSON) | M | S | done (this PR: drives as one GPX file, account data as JSON) | GDPR portability |
| Z-05 | Security review of auth, crew and convoy endpoints before launch | H | M | partial (#132, #135, audit 2026-10-28; Z-09 to Z-15 are what it left) | production readiness |
| Z-06 | Convoy positions ephemeral, scoped to joined members, revoked on leave, never logged | H | S | partial (#84) | docs/CONVOY_TRANSPORT.md |
| Z-07 | Privacy policy and terms written for real (and linked in the app and store) | H | S | owner (legal) | App Store requirement |
| Z-08 | Minimum k-anonymity for road bins shown publicly (don't show a bin only one driver touched near a home) | M | S | done: `GET /api/roads` returns a road+direction only once 2 different people drove it (`MIN_DRIVERS`, counted from rank_slots), except open roads (motorway to tertiary, or unclassified ≥1.5 km of map line: migration 0029 `road_ways.cls`/`len_m`), shown from the first pass at lower weight (owner decision 2026-10-28, docs/ROAD_DATA.md) | Strava heatmap lesson |
| Z-09 | iOS web view is `isInspectable = true` in release builds: Safari Web Inspector on a Mac with the unlocked phone plugged in can read the session token from localStorage. Gate it behind `#if DEBUG` or a hidden developer toggle | M | S | done (#143) | audit 2026-10-28 |
| Z-10 | App session token lives in web localStorage; keep it in the iOS Keychain and hand it to the page per request through the bridge | M | M | done: the shell keeps it in the Keychain (`ApexKeychain`, this device only) and makes the page's /api calls (`ApexApiBridge`, a reply handler `apexApi`), so page script never sees it; an older build's stored token moves over once and is deleted from page storage; sign-out, account deletion and Erase clear it (`web/sync.js`, tests/test_session_bridge.py) | audit 2026-10-28 |
| Z-11 | Content-Security-Policy beyond `frame-ancestors` (script-src for the inline scripts by hash, connect-src for the map/route hosts): defence in depth now that a session token sits in page storage | M | M | done: every page carries a CSP `<meta>` (so it holds in the iOS shell too): scripts only from the app, its inline scripts by SHA-256 and the voice engine's CDN (`wasm-unsafe-eval`, no eval); `connect-src` lists each host the app uses; no plugins, `base-uri 'none'`. `tools/csp.py` writes it, `tests/test_csp.py` keeps it current, e2e fails on any violation; checked live with the map and the voice model loading | audit 2026-10-28 |
| Z-12 | The outgoing friend-request list shows a pending row only for real member handles, so typing handles still tells you which exist (the request answer itself is uniform). Show sent requests for unknown handles too, or not at all | L | S | done (this PR: the server no longer lists sent requests; the phone shows every handle you sent to alike; cancel by handle answers the same either way) | audit 2026-10-28 |
| Z-13 | Convoy members see each other's Google display name (`who()` in convoy_routes.ts), unlike crews and boards since #132. Send the handle only, or the name only between friends | L | S | done (this PR: handle only, the Google name never enters the convoy room) | audit 2026-10-28 |
| Z-14 | Map matching sends the (trimmed) drive trace with the phone's IP to the public Valhalla demo server, and routing sends start and end points to public servers. Self-hosting (Y-04) fixes both; say it in the privacy policy (Z-07) until then | M | L | owner (cost) | audit 2026-10-28 |
| Z-15 | Crew invite links are multi-use, never revocable and uncapped per owner (account invites are capped at 10 open). Add revoke on the crew card and a cap | L | S | done (this PR: 10 live links per owner, "Turn off invite links" on the crew card) | audit 2026-10-28 |

## 13. Android and web parity (A)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| A-01 | Android shell (WebView + native sensors) reusing the web cockpit like the iOS shell | H | XL | owner (Android priority) | ARCHITECTURE thin shells |
| A-02 | Web: mount calibration in the browser so the web app can share measured road data | M | M | done: web/live_pipeline.js (exact port, parity-tested on the ApexKit fixture), fed by DeviceMotion; banking counts only after a GPS cross-check, so an engine with flipped signs never contributes (tested) | STATE 2026-10-27 |
| A-03 | Web: installable PWA with offline shell and home screen icon | M | S | done: `manifest.webmanifest` (192/512 icons) and `sw.js`, network first with the last copy offline, never /api, voices or other hosts; websites only (not apexnav://, not the e2e host) | — |
| A-04 | Place suggestions while typing (Apple search in the app, Photon on the web) | M | S | done (#73) | WORKER_QUEUE plan-suggest |
| A-05 | Desktop planning view: big map, route list, GPX, send to phone | M | M | done: from 1100 px wide, Where to? is a 440 px column on the left and every sheet a 480 px panel on the right, the map in view; with mouse drag-to-reshape, stops, GPX in/out, saved routes, and Share (a link the phone opens) it plans at a desk | Kurviger desktop, Calimoto web planner |

## 14. Launch and business (L)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| L-01 | Apple developer account, TestFlight external beta | H | S | owner (account) | launch |
| L-02 | Money model written down: free forever, Pro subscription or lifetime, road-data framework | H | S | partial: docs/MONETIZATION.md (free forever; Vetta Pro monthly / yearly / lifetime; founders keep Pro; Pro earned by measuring roads; road data sold as facts about roads, never people, docs/ROAD_DATA.md). Waiting on the owner's yes to the prices and split; then the StoreKit build behind the `pro` flag | mission |
| L-06 | Marketing plan run by Claude: road pages for search, a weekly road video, community posts drafted for the owner, club and press outreach, a weekly report | H | M | partial: docs/MARKETING.md and drafts in docs/marketing/. Waiting on the owner's domain and accounts (OWNER_TODO) | owner 2026-10-28 |
| L-03 | Licence audit of every dependency and voice model before charging | H | S | done (THIRD_PARTY_NOTICES.md audit note; web/licenses.html ships the BSD/MIT notices in the app, linked from Settings; the website-only voice engine is never loaded in the app, guideline 2.5.2) | docs/VOICE.md licences |
| L-04 | Attribution for OSM, OpenFreeMap, Valhalla, Nominatim, Photon, DeFlock, Kokoro (Settings → Sources and licences) | M | S | done | licences |
| L-05 | Support channel and feedback button that attaches anonymous diagnostics | M | S | done: Settings → Feedback (`web/feedback.js`, `POST /api/feedback`, migration 0017), optional diagnostics (version from the app's user agent, device, screen, language, error count), handle only for a reply; owner list in Crew | — |
