# Fun routing

How Vetta picks the way from A to B (web/fun_route.js, wired in web/cockpit.js `funRoute`), and how
loops are sized (see Loops below; stage discovery itself is web/stages.js and docs/ROAD_INTELLIGENCE.md §7).

## The route engine (2026-11-04)

Every candidate (A→B, loops, Explore's stages) is now ranked by the route engine (web/route_engine.js; the reference is
docs/ROUTE_ENGINE.md). Each candidate becomes a corridor of 25 m samples with the time you'd be at each; the route
context providers (web/route_ctx: the router's edge attributes, the DEM, and the map-feature, national-grid, world and
crowd providers as they land) answer for all candidates of a plan at once within 4 s; the engine scores each 25 m for
**quality** (is this a road worth driving: speed limit, class, density, signals, driveways, businesses …) and
**scenery**, counts corners only where quality earns them, costs side streets and business districts per km, applies
time-dependent penalties and hard constraints, and says why the winner beat the quickest from the largest differences.
The router's costing keeps off highways, which sent routes through subdivisions and strip malls: the highway-friendly
quickest now competes on every trip (unless you avoid highways), connectors between good roads may use highways, and the
best stages are re-scored on their real road before any connector is timed. Everything below (levels, budgets, avoid,
towns, glare, weather, measured roads, taste, Prefer, set list, stage coverage, the car) feeds the engine's value as
before; with no context at all the value is exactly the old one. The quickest route goes up as soon as the router
answers and the ranked routes replace it.

## Levels

The Plan sheet and the route card have a **Roads** choice, saved on the phone (`apex.funLevel`):

| level | most extra time over the quickest route | a detour must add about |
|---|---|---|
| Quick | 10 % + 1 min | 6 good corners a minute |
| Fun (default) | 35 % + 4 min | 2 good corners a minute |
| Max fun | 90 % + 10 min | 0.7 good corners a minute |

Changing the level re-plans a destination route that is not being driven (not while one is being planned; a route with a stop you added keeps it and the level applies to the next route). Loops ignore the level, so their card hides it.

## Avoid

Under Roads, an **Avoid** row (saved on the phone, `apex.avoid`): Highways, Tolls, Ferries, Unpaved (on by default:
stages never use unpaved roads and most cars here don't want gravel). They set Valhalla's costing for routes and the
connector matrix (`FunRoute.costing`: `use_highways`/`use_tolls`/`use_ferry` 0, `exclude_unpaved`). These are strong
preferences, not bans, so each route's summary flags (`has_highway`, `has_toll`, `has_ferry`) are checked: candidates
that still use an avoided road are dropped when any candidate doesn't (`keepAvoiding`, loops too), and when none can
avoid it the route card says so ("Couldn't avoid tolls", e.g. the Chesapeake Bay Bridge-Tunnel). The OSRM fallback
knows none of this and says nothing. Toggling one re-plans a destination route like the level does.

**Towns** (off by default) is not something the router can avoid, so it is a ranking cost: city, town and village points
come from the map tiles (`ApexStages.places`: z11 tiles within 4 km of the candidates, at most 80; z9 and z10 drop most
villages in busy country, e.g. 11 of 79 places in northern NJ at z9), every candidate (A→B and loops) gets the km it spends
within 4 km of a city, 1.5 km of a town or 0.6 km of a village (`FunRoute.townKm`, 100 m steps; the places you start
or end in don't count), and ranking takes 3 points a km, at most 60 (a city crossing is about 24). Circles round a point,
not the town's real edge. The card says "Through towns ~N mi" from 1 mi, the why line and toast say when fewer towns are
part of the extra time ("2.5 mi less in towns, +4 min"), and when the places couldn't be loaded (no tiles, a trip too big)
it says "Couldn't check towns" instead of pretending there are none. Checked: west Knoxville → Townsend, 10.5 km of town
(Alcoa/Maryville) and no town-free alternate; Morristown → Rahway NJ, the winner has 29.5 km of town against 19.5–25 km for
others, so the card says ~18 mi (fun outweighed the town cost there).

## Which way round a stage

Before loop and detour plans are ranked, each shortlisted stage gets the elevation of its two ends from the Terrarium DEM
tiles the map uses for hillshade (`ApexStages.addElevations`, z12; Newfound Gap reads 1,539 m). When a stage climbs 40 m or
more end to end, driving it the better way round adds 15% of its value in the ranking (`FunRoute.directionBonus`): a
technical stage (1.2+ tight corners a km) climbed, a flowing one descended. Tight corners uphill come with less speed and
more weight on the front tyres. The crow-fly fallback planner takes the better end when it costs at most 3 km more
connector. No DEM: nothing changes (IDEAS R-11).

Your car (IDEAS R-20): the Garage's daily car, kept on the phone, plans every route. A lowered car never gets unpaved roads
(even with Unpaved allowed), and a width with mirrors goes to the router as `width`, so roads with a posted width limit it
won't fit are left out. The route card says "Planned for your …". No ride height or width: nothing changes.

Set list (IDEAS R-12): among plans with the same stages, the order that finishes on the most technical one (tight corners
per km) gets 4% of their value, so a loop or a two-stage trip builds to its hardest road; three stages of 2.5+ tight
corners per km back to back lose 25%, since tiring on hard roads is a safety issue (`FunRoute.setList`).

## Home by

A loop's route card takes a **Home by** time (the next time it comes round; an hour or more ago means tomorrow). While the loop
is driven, when the live arrival (above) is more than 5 minutes past it, a toast offers **Head home**, once and then again
after 10 minutes if still late; it plans the quickest way from where you are back to the loop's start (IDEAS R-37,
`homeByOffer` in web/eta.js).

## Did the route drive the stage?

The router joins a stage's shaping points by the quickest way it finds, which can be a parallel road that skips the stage.
Every routed stage plan (A to B and loops) is checked against what came back: each stage is sampled about every 50 m and
the share of samples within 40 m of the returned route is its coverage. Under 70% on any stage, the plan is dropped
(`FunRoute.stageCoverage`, IDEAS R-14); the router's own routes and the circle loop still compete.

## Closed at times

A planned route asks Overpass for the roads in its box (up to 1° across) that carry a conditional closing rule
(`motor_vehicle`, `motorcar`, `vehicle` or `access` `:conditional` = `no @ (...)`), keeps those within 80 m of the route,
and reads each rule for the time you'd get there: date ranges ("Nov 15-Apr 15", "Nov-Apr", years ignored), times
("19:00-07:00") and weekdays ("Mo-Fr 07:00-09:00"). The card says what is closed then, what is closed at other times, and
shows a rule it can't read as written (`sunset-sunrise`, `wet`) rather than guessing (IDEAS R-22). A closure that applies
then gets a "Route around it" button: its point goes to the router as an excluded location (10 m) and the route is planned
again, keeping your stops; the excluded points stay for the rest of the session's plans.

## Weather along the way

A planned route gets the forecast at six points along it, each for the hour you would reach it if you left now (the router's
own times; 50 km/h where it gave none), from Open-Meteo in one request. The route card names what changes the drive, once
each and where it starts: ice risk (at or below 1 °C and wet, or freezing rain), snow, thunderstorms, rain likely (60%+ or
0.3 mm+), fog (under 1 km or a fog code), very hot (35 °C+); or says there's no rain, ice or fog. Beyond the forecast or
offline: nothing is said (IDEAS R-21, `web/route_weather.js`). When a fun route is chosen, the top four candidates each get
their own forecast and a cost in fun points by the share of their points with ice or snow (30), storms (15), rain (6) or
fog (4); only the difference from the driest counts, so rain over the whole area changes nothing, and if any forecast
fails none counts.

## Stops of the day

The route card lists your stops in order (a pin's Add via, a dragged route, or a viewpoint, café or fuel pin along the route:
tap it, then Add as a stop). Up, Down and Remove rebuild the route through the stops as listed; the planner's shaping points
are dropped then, since they were chosen for the old order (`web/trip_stops.js`, IDEAS R-17).

## Avoid cameras

Avoid → **Cameras** (off by default) asks the camera map (OSM `surveillance:type=ALPR`, DeFlock, via Overpass, kept a week)
for the plate readers within about 2 km of the trip and sends the router those nearest the start-to-end line as
`exclude_locations`, with any reported closures, 50 at most (`FunRoute.camerasToExclude`). The router avoids the road edge
nearest each camera. A trip more than 1° across, the camera map offline, or no way round them: the route is built without
avoiding cameras and a toast says so; the cameras still on the route are marked and counted as before (IDEAS R-35).

## Avoid police reports

Avoid → **Police reports** (off by default; the owner, 2026-11-11) keeps a plan away from the live "Police" reports near the
trip: drivers' reports (`/api/hazards`, members only; the server keeps one 60 min from its last confirmation and drops it
there, and one cleared by more drivers than confirmed it is skipped here) and a convoy leader's live Police call, 20 at
most within 15 km of the trip (`ApexHazardReports.policeFor`). The router gets them as `exclude_locations` with the closures
(cameras take what is left of the 50); our own router costs every road within 150 m of one x8 (`graph_router.js`
`AVOID_POINT_X`), so a way round wins when there is one near. A route that still passes within 150 m of one is dropped when
any candidate doesn't (`FunRoute.unavoided`, `passesNear`), and the card says "Couldn't avoid police reports"; one that
went round says "Around a police report" (or "Around 3 police reports"). Signed out, there are no reports to avoid: the
plan is the usual one and a toast says to sign in. A plan never waits more than 0.2 s for the reports (the route card's 0.75 s budget): reports for the area from the last 5 min are used at once, Where to? opening asks for them ahead, and ones that land later still reach the router's requests and the card. There is no checkpoint
report and none is made from these (App Store 1.4.3, docs/APP_REVIEW.md).

## Drag to reshape

A planned route (not while driving or playing) can be dragged: a mouse grabs the line at once, a finger holds still on it for
0.35 s first so that panning across the route still pans. Where it is let go becomes a stop, ordered by where along the route
it was grabbed (`FunRoute.insertVia`, as the pin's Add via), and the route is rebuilt through it. Held and let go without
moving, it is the long-press pin, as before (IDEAS R-18).

## Routes from elsewhere

Where to? takes a pasted Google Maps (`/maps/dir/…`, `?api=1&destination=…&waypoints=…`, `/place/…/@lat,lon`), Apple Maps
(`daddr`, `saddr`, `ll`) or `geo:` link: places written as words are searched, the stops are routed through in order, and a
link with no stops is planned like any destination (fun level and all). Short `maps.app.goo.gl` links can't be expanded from
the page; the app says to open them in a browser first. **Open GPX** (and, in the iOS app, "Open in Vetta" on a .gpx from
Files, Mail or AirDrop) follows a track exactly as drawn, with our notes worked out from it; a file with only route points or
waypoints is routed through them. The route card's **GPX** saves the planned route as a track (IDEAS R-25, R-26;
web/route_import.js, tests/test_route_import.py).

## Along the route

Once a route is planned, the `poi` layer of the same OpenFreeMap tiles at z14 is read under it (sampled every 1 km, at most
160 tiles; `ApexStages.pois`) and web/scenic.js keeps viewpoints within 350 m of the road and cafés and fuel within 200 m,
one per kind per 300 m (a named one kept). They are pinned on the map, and the route card says "7 viewpoints · 1 café", plus
"no fuel for 62 mi (mi 10–72)" when a stretch of 50 mi or more has none (IDEAS R-24, R-23). Map data: a mapped viewpoint,
a station that may be closed. Offline or a very long route: nothing is said.

## Reported closures

Before each route request, live "Road closed" reports (IDEAS Q-15) within 50 km of the trip's middle are fetched for members
(kept 5 minutes) and those inside the trip's box widened by 15 km go to the router as `exclude_locations` (at most 30,
nearest the middle first; `closuresFor` in web/hazard_reports.js). If the router finds no way around them, the route is
asked again without them and a toast says a reported closure is in the way (IDEAS Q-17).

## Corners you like

Plan → **Hairpins** fewer / more and **Sweepers** fewer / more (IDEAS R-19, saved on the phone): in the fun score of every
candidate, tight corners (hairpins, 1s and 2s) or fast sweepers (5s and 6s) weigh 60% more or less (`cornerWeight` in
web/fun_route.js). Nothing chosen, the scores are exactly as before (tests/test_road_prefs.py). A change re-plans the
destination route on screen like the Avoid chips do.

## Candidates

1. The router's route (Valhalla, highways and tolls de-prioritised) and up to 2 Valhalla alternates
   (`alternates: 2`), plus the highway-friendly quickest (use_highways 1.0, `ApexRouteEngine.highwayCosting`) unless
   Avoid → Highways is on; a highway-costed winner is pinned with shaping points like an alternate. OSRM is the fallback
   when Valhalla is down. Stage plans and the connector matrix use `connectorCosting` (use_highways 0.6).
2. Quick stops there. Fun and Max fun also look for **stages** (web/stages.js: OpenFreeMap vector
   tiles, roads joined into strokes, each stroke's best 2–10 km window scored on corners and
   junctions) in a circle around the A→B midpoint (radius half the trip + 3 km, at most 64 tiles,
   which is about 11–12 km at 40°N). Trips over 22 km crow fly are also cut into sections of about
   24 km along the quickest route (2 on Fun, up to 3 on Max fun); each section gets its own stage
   search and plans, and the best of each section (plus variants swapping one section for its
   second best, at most 4 stages in all, a stage two sections both found driven once, the whole
   trip kept within the level's budget) compete with the single-corridor plans (skipped past 48 km
   crow fly, where its connectors are too long for the matrix). So long trips get
   stages all along the way, not only in the middle (Knoxville → Asheville on Fun: Fun 47 for
   +17 min, where before no fun option was found).
3. Up to 4 stages inside the level's ellipse around A→B are shortlisted, and one Valhalla
   `sources_to_targets` call (A and every stage end as sources, every stage end and B as targets,
   at most 9 x 9 = 81 pairs; the public server allows 100) gives real connector times. Crow-fly
   guesses were wildly wrong in hills: in the Smokies two stages 10 km apart were 80 km by road.
4. Plans of 1–2 stages, each driven either way, are timed as A→entry + stage (at 50 km/h) +
   exit→next entry + … + exit→B, kept within the level's budget, ranked by stage score minus the
   level's time cost; the best 2 are routed with each stage's entry, exit and midpoints as shaping
   points (`through`, 25 m radius). Those points become the route's vias, so a reroute still
   drives the stages ahead.
5. A winning router alternate (not the quickest) is pinned with shaping points about every 5–6 km
   (at most 8), so a reroute or an added stop stays on it instead of falling back to the quickest
   road. An added stop is inserted where it falls along the route. Trips under 3 km crow fly skip
   the stage search. Quick may still take an alternate up to 10 % + 1 min slower when it is
   clearly more fun.

Any step that fails (no tiles, no matrix, a stage route that fails) just leaves fewer candidates;
the router's own route is always there.

## Options

A destination route offers up to 3 options side by side (R-30): the ranked candidates with near-duplicates dropped
(`FunRoute.distinctOptions`: within 30 s and 1 fun point of one already kept). The route card shows a chip each
("Fun 79 · 128 min") and the map draws the others dashed; tapping a chip or a dashed line makes that option the
route, with its own why line, glare and avoid notes ("+N for fun" and the why line still compare to the quickest).
Hidden while driving and for loops.

## Explore

**Explore** (15 min / 30 min chips under Loop, R-10): the best roads you can reach from here in that time. Stage discovery
runs around you (radius 45 km/h crow fly x the minutes, at most 14 km), the best 12 stages that aren't the same road (by
place or by name) get one Valhalla matrix call from here to both ends of each (24 pairs), and the ones whose nearer end is
within the time are listed best first (at most 5): road name, good corners, length, minutes to its start. They are drawn on
the map too; tapping a row or a line routes from here into the near end and through the whole stage to its far end (shaping
points, so a reroute stays on it). Names come from the same vector tiles (`transportation_name`, `ApexStages.nameStages`:
the name under at least 2 of 5 points along it), else "Road name unknown" (unknown, not unnamed); a bare number reads "Route 28". Checked: Maryville TN,
30 min → Little River Gorge Road (42 good corners, 6.2 mi, 28 min away), Fence Rail Gap Road, Old Walland Highway; south of
there, 15 min → Calderwood Highway (9 min away).

**Never a neighbourhood** (the owner, 2026-11-04: the top pick was a residential neighbourhood). A road in the list is a
through road worth driving, judged on the data, not the corners:
- *Neighbourhood street* (`ApexFunRoute.streetSample`): residential, living-street or service class with built-up frontage
  beside it (40+ addresses or 60+ buildings per km, density 6+, or a posted 25 mph where there is any density). Class
  alone never decides: TIGER tags county lanes "residential" (Second Creek Road, Big Cedar Road: no houses, density 1),
  and with nothing known beside it the answer is unknown, not a guess. A stage is a street when half of the samples whose
  answer is known are, over a third of it.
- *From our tiles* (graph_router.js `explore`): no neighbourhood edge seeds or extends a stage (edges with destination-only
  access neither). An end that runs into a dead end is cut back to the last junction (a spur goes), unless the dead-end
  run is 2 km or more of good road (`OUT_BACK_KM`): a long rural road that ends is still worth driving there and back
  (Cook Road, Mudlick Road, Second Creek Road stay; such a stage carries `deadEnd: true`).
- *From the map's stage search* (stages.js, used where our tiles found nothing): `rescoreStages` marks a stage `notRoad`
  when the context shows it is a neighbourhood street, or when our tiles' own model (route_ctx/graph.js `graph_quality`,
  where they cover it) scores it under 0.45 on average, the same bar our tiles' search uses. The list skips those, and
  skips any stage the engine never looked at once it has looked at some (it looks at the first 12).
- Checked (tests/test_graph_router.py, real tiles): from Devou Park the top pick was Parkway Avenue through Kenton Hills
  (74 houses per km, density 10), now Petersburg Road; near Mount Airy Forest, Lafayette Avenue through Clifton (residential
  class all along, 57 addresses per km, density 10, posted 25 mph on most of it) is no longer listed. Not fixed: outside our tiles, with the live
  context too slow to say (the router's edges come back partial in 1.2 s), a neighbourhood is unknown and can still be listed.

## There and back (2026-11-10)

A drive out to a café or a viewpoint is two drives, and the second should be new road. **There and back, home another
way** on a trip's card plans the trip home too: where our tiles cover both ends, `graph_router.js roundTrip` pairs ways
out (the level's plan: its pick and alternates, `ROUND_PAIRS`) with a way back whose search costs the way out x4 both
ways (`ROUND_RETRACE_X`), at the weights `ROUND_A` per level and chosen by the level's own `pick()` (Fun and Long way
spend time on good road home, never a highway); pairs driving a fifth or less of themselves twice come first, then the
most good road. Elsewhere the way out on the card stays and Valhalla is asked for the way back with points along the way
out as `exclude_locations` (1 km apart, 1.5 km kept clear of each end, at most 40), taking the alternate that shares
least with it. Either way the whole trip is routed through shaping points every 2.5 km with the destination as your stop
(`request.round`), so the stop list, a reroute and Remove behave as on any trip with a stop. The card says how much of
the way home is new road, or "no other way home here" (a dead-end valley). Tests: tests/test_graph_router.py
`test_there_and_back_comes_home_by_other_road`; e2e "there and back".

## Loops

Loops chain stages found around the start. Their length used to come from crow-fly connectors x 1.6,
which ran 40–75 % long in hills (a 45 mi request around Knoxville routed to 99–102 km). Now the best
6 stages that can be reached and returned from are shortlisted (`loopShortlist`), one Valhalla matrix
(13 x 13, sent as two calls of at most 100 pairs) gives real road distances between the start and
every stage end, and `loopPlansFromMatrix` chains 1–3 of them in any order and direction within 25 %
of the target. Same value formula as before (stage score x (1 − length error) − 0.08 per connector
km). The crow-fly plans are the fallback when the matrix fails, and the circle loop is still routed
as a baseline. Routed loops are then ranked on the same fun score as A→B routes (`FunRoute.loopValue`:
Fun minus 2 points per % of the loop driven twice and 0.8 per % off the asked length), so junction turns
no longer count as corners on loops and the measured adjustment means the same on both. Checked against the public servers: routed loops now land within about 15 % of the
target (Knoxville 30 mi: 43–44 km after spur removal; 45 mi: 58–62 km; Cincinnati 30 mi: 46–48 km).

**By time** (1 h / 2 h chips, R-16): the same loop builder planned on drive time instead of distance. The search
radius assumes 35 km/h, the matrix gives connector times, stages count at 25 km/h (the router times twisty roads far
below 50: a 43 km Smokies loop is 83 min), and routed loops are judged on the router's time against the target
(`FunRoute.LOOP_BY_TIME`, `loopValue` on seconds). The card names the loop by its real time ("119 min loop"). Knoxville:
2 h → 119 min; 1 h → 75 min, because the good roads nearest the start are 40 km of driving away (the toast says
"75 min: the closest good loop to 1 h").

## Measured roads

For members, the top 3 candidates of a destination route or loop are matched to OSM ways (Valhalla
trace_attributes + Overpass geometry, up to 150 ways in batches of 50 for `/api/roads`) and get
`ApexContributor.measuredAdjust` added to their value:

- rough surface: up to −8 (0.08 g rms fine … 0.38 g fully rough, the core effective_mu scale);
- smooth surface: up to +3, full at ≤ 0.05 g rms fading to 0 at 0.08 g (where the rough ramp starts);
- banked into the corners (camber ≥ +3°): up to +2 when a tenth of the route is; off-camber
  (≤ −3°, a hazard): the same scale, negative;
- each term is weighted by how much of the route that signal measured with agreeing passes (full
  weight at two thirds) and by passes (one pass counts 3/4);
- readings whose passes disagree (`ApexContributor.agreement` says 'differ': camber spread over 1.5°,
  roughness over 0.05 g) are left out entirely; they still count as covered in the "Measured by
  members" note, but never as weight.

Unmeasured roads are neutral: a road nobody has driven is never penalised or rewarded. With fun
scores on 0–100 this decides close calls (a fully rough road loses a 6-point lead) but cannot make a
dull road beat a much better one (it keeps a 20-point lead). The route card adds a **Surface** bar
(100 = glass) once a fifth of the route has agreeing roughness readings. Not used yet: crest (not uploaded, see
ARCHITECTURE §1), hazards, and measured data during stage discovery itself (stages are still found on
map geometry; measured data only re-ranks routed candidates).

## Route context: time and the world (2026-11-03)

Providers in `web/route_ctx/` (ROUTE_ENGINE_CONTRACT: `ApexRouteCtx.register`, one fetch for all candidates of a plan, per-sample
channels with NaN for unknown, spans and points) evaluate each 25 m sample at its own eta. Each file's header documents its
channels, sources, licences and cadence; the engine (builder A) weighs them.
- `conditions.js`: Open-Meteo per 0.05° cell (an hour's cache): air and ground temperature, visibility and a fog risk raised in
  valleys and cut on ridges (from `tpi_m` or the DEM against the cell's terrain), wind, gusts and the gust's crosswind against
  the heading (with ridge/bridge exposure), rain in the last 6 and 48 h, route_weather.js's hazard per sample, light (day,
  civil twilight, dark), glare (the R-13 cone) and a golden-hour view on descents that never rewards the glare cone. Spans fog,
  crosswind, cold-tyres (< 7 °C), ice (frost or wet at ≤ 0.5 °C), dark, glare, golden-view.
- `wildlife.js`: deer risk = sun-relative hour (fitted to OSHP's 26 % / 31 % dawn and dusk shares) x the state's month (each
  state agency's Q4 and November shares) x land (forest edge high, towns low; unknown without land use). Span deer-hour.
- `events.js`: MLB and Triple-A games (MLB Stats API), other sports and concerts with a SeatGeek id, sized by a venue table;
  arrival 2.5 h before to the start, departure to 1 h after; school runs near schools on school days, bus hours, Sunday and
  Saturday-vigil church hours (OSM places). City permit data for festivals and closures was checked (Cincinnati, Columbus,
  Louisville, Lexington): none current and machine-readable.
- `hazards_live.js`: NOAA flood categories and USGS 24 h rises near the route and at fords (with conditions' 48 h rain), WZDx
  work zones and closures (Indiana direct, Kentucky via `/api/ctx/workzones`, Ohio with an OHGO key; paving labelled), harvest
  (NASS weekly progress, else the USDA usual dates) x farmland, NPS monthly visits in the parks, typical fall-colour peak by
  latitude and height x canopy. No snowplough feed exists in OHGO's public API.
- `photos.js`: Wikimedia Commons photo spots within 250 m as a saturating scenic score; Mapillary
  speed-limit signs (carried 2 km, fills missing maxspeed) and curve-warning signs with a token.
Tests: `tests/test_route_ctx_*.py` on real answers for the Cincinnati area saved 2026-11-03 (`tests/fixtures/route_ctx/`).

## Sun glare

Every candidate (A→B and loops) is driven in time from now over its router time, and each 100 m that heads within
20° of a sun 0–15° above the horizon counts as glare (`FunRoute.glare`, `ApexSun.sunPosition`, NOAA). Ranking takes
1 point per glare minute, at most 20, so a road straight into the setting sun loses a close call but not a much
better road. The route card warns "Low sun ahead for ~N min" from 3 minutes. Checked: Knoxville → west at 5:40 pm in
late October, every candidate has 22–34 min of it and the card says so. Not kept when a route is restored later
(the time has moved on).

## When to go (2026-11-10)

A route is not the same drive at every hour. `web/when_to_go.js` drives the route on the card at every half hour of the
next 24 h (every hour past 150 km) and values each departure with the route engine's own model: the corridor is shifted
in time (`shift`), the providers that hold the hour in their answers (conditions, wildlife, events, hazards-live: `TIMED`)
are asked again for all departures in one run (`ApexRouteCtx.run` with `inputs`: the plan's context is their terrain and
land use; the forecast is cached per cell three days ahead, so no new request), their answers replace the plan's hour in
the context (`overlay`: a timed provider that didn't answer leaves its channels unknown, never the other hour's), and
`ApexRouteEngine.evaluate` gives the penalties, bonuses and hard constraints (the road's quality and scenery per sample
are worked out once: `opts.samples`).

A departure's value is the part of the route's value that moves with the clock: bonuses (golden light) − penalties
(deer hours, school runs, events, works, fog, cold road, ice…) − glare (1 a minute, at most 20) − the forecast
(route_weather.js COST by the share of the route in rain, storms, snow or ice) − **scenery not seen**: the route's scenery
points times the share of it driven in the dark. That last term is the one thing here the plan's ranking doesn't have.

The card's line (`advice`), in this order: closed if you leave now ("… Open from 12:00"); **Better at 6:30 PM: no school
run, golden light** when a departure between 06:00 and 22:00 beats now by 3 points or more; **Leave by 9:30 PM: rain
likely after** when now is as good as it gets and the value falls 4 points within 3 hours (the departure named is still
dry); else "No better time to leave in the next day". A departure whose forecast isn't known is never called better when
now's is, and with no forecast at all the line and the panel say so ("by the sun and the calendar only").

A tap opens the day as a ribbon: one bar per departure, taller is a better drive, night dimmed, a closed hour no bar;
arrows and Home/End move the pick; under it the pick in words and what it gains or loses on now. **Plan for 6:30 PM**
sets the plan's hour (`leaveAtMs` in cockpit.js): a trip to a place is ranked again for that hour (corridors, glare,
the forecast in the ranking), a loop or GPX keeps its line and gets that hour's glare, forecast line and timed closures.
The line then reads "Leaving 6:30 PM: dry, daylight"; Leave now, Start, or clearing the route puts the clock back.
It runs 1.2 s after the card is up, yields to the page between departures, and never holds the card. Kill switch: flag
`when_to_go`. Tests: tests/test_when_to_go.py (a real Cincinnati forecast with rain on 4 Nov); e2e "when to go".

**Found while building it:** `sun.js` and `route_weather.js` loaded after conditions.js, wildlife.js and hazards_live.js,
which take them once as they load, so in the app (not in the node tests) no route had light, glare, golden-view, deer
hour or forecast hazard per sample. They now load first; tests/test_when_to_go.py holds the order.

## Time left while driving

While a planned route (A→B, loop or Explore) is driven, the drive bar shows "48 min left · 5:12 PM" (web/eta.js,
WORKER_QUEUE eta-1). The time is the router's own for the part ahead: its maneuver times placed along the track
(`timeMarksOf`), else its total time spread evenly by distance. It is scaled by your pace on this route so far: real
seconds over router seconds for the part driven, used only after 2 min and 1 router-minute of driving, bounded to
0.6–1.8 and smoothed, so a red light or a jam doesn't swing it (tests/test_eta.py). A reroute or a new drive starts the pace
over. Blank off route, on a recorded drive, or when the router gave no time. No traffic goes into it.

## Spoken directions

The router's maneuvers are kept with the route (`stepsOf`, placed in route order so a loop's second pass of a junction is
not the first) and spoken in the co-driver's voice (web/directions.js, IDEAS V-04). One maneuver at a time, in road order,
as Apple Maps and Google Maps do (the owner's drive, 2026-10-30: the exit, then the sharp right a mile on, then the exit
again): only the next turn not yet taken is said, and it is taken 30 m past it, never reinstated by a fix that falls back
over it (`createProgress`, shared with the car's card, web/carplay.js guideMessage `step`). Its prompts are a ladder said
once each: "In 0.4 miles, turn left onto Deals Gap Road" at 30 s out (400 m to 1 mile), again at 12 s (150 to 400 m),
then "Turn left onto Deals Gap Road" at max(40 m, 5 s), with ", then turn right onto US 129" when the next turn is within
150 m; a rung inside 3 s of the call at the turn is left out. Roundabouts name the exit; the end says "Arriving at your
destination". Starts, "continue" and "stay straight" are never said. The call at the turn is a hazard-priority line (ahead
of corner notes); a corner note within 35 m of a junction is left out, so one bend is never called twice, and no note past
a junction is read until that junction's call at the turn has been said (it then queues behind it, or is skipped as too
late). Any notes mode; off route, nothing. tests/test_turn_order.py; e2e "turn by turn in road order".
A route rebuilt from a shared shape has no maneuvers and so no directions.

## Fun score (map only)

`ApexFunRoute.score` on 5 m geometry (`geometry()`: resample, curvature, corner detection from the
parity-tested core):

- Corners at the router's junction maneuvers (turns, ramps, roundabouts; within 30 m of the apex)
  are dropped: a grid of town streets is not a twisty road.
- **Twist** = weighted corners per km (severity 2–5 count 1, 6 and hairpins 0.6, 1 counts 0.5);
  3 per km = 100.
- **Flow** = share of the route in runs of 3+ corners each within 250 m of the last; 50 % = 100.
- **Dull** = share of the route in straights longer than 1.5 km.
- **Fun** = 0.5 Twist + 0.35 Flow + 0.15 (1 − Dull) x 100.

Ranking: `fun + 0.5 x good corners gained over the quickest route (capped at 60) − perMin x
extra minutes + measured adjustment`, after dropping anything past the level's budget; the route engine adds quality,
scenery, side-street, bonus and penalty terms and gates each corner by the road's quality (docs/ROUTE_ENGINE.md). Fun is a
density, so a long route through a great stage barely moves it; the corner gain is what pays for
the detour. For members, the top candidates also get what others measured on those roads
(see Measured roads below).

The route card shows Fun / Twist / Flow for a planned route and Twist / Flow / Surface from
measured sectors for a driven one, plus the router's time and "+N for fun" over the quickest.
These are map-derived, never measured road feel. When the winner is slower than the quickest route, a line under the bars says
why (`FunRoute.why`, from the router's own road names): the roads it spends 2+ km more on (at most 3), the
good corners it gains and the minutes it costs, e.g. "For SR 360 13 mi, Cold Spring Road 8.2 mi · 167 more
good corners, +30 min".

## Route context: the driver, the car, the crowd and the phone (web/route_ctx, builder E)

Five providers of the route engine's context (the contract in the route engine's docs: `ApexRouteCtx.register`, channels per
25 m sample with NaN for unknown, spans and points). Each file's header lists its channels with unit, meaning, source,
licence and cadence; `ctx_util.js` queues them in `ApexRouteCtx.pending` until the engine's registry loads and adopts them.
What each one is for, and how it should move a route:

- **crowd.js** (`/api/roads`, members only): `crowd_rough_g`, `crowd_bank_deg`, `crowd_curv`, `crowd_conf` as the measured-roads
  path had them, now per sample; **`crowd_flow`**, how smoothly members drive a road (each pass's speed steadiness over ~40 m
  times the share that didn't brake hard with no corner ahead; computed on the phone, contributor.js `binFlow`, sent as a
  ratio and a yes/no, never a speed; merged in `road_bins.flow_mean/brake_mean`): a quality term (stop-start roads lose to
  ones members flow through) and the "Members drive it smoothly" span; **`loved`**, the most of members coming back to a road
  on a second recorded drive (`road_love`, a level from two people), your crews' shared lines, your own "Which road was
  better?" Elo by road name and roads you drove twice: a fun term with a "loved" span named for the road; **`taste`**, your
  taste fit (taste.js) over 2 km windows in fun points (fit from your answers and, at half weight, the routes you
  Start instead of Vetta's pick); **`crowd_busy`**, the busy-time ratio at your ETA, only with the
  `quiet_hours` flag on (the owner's open decision; default off: no hour is sent, stored or shown).
- **driver.js** (phone only; Overpass tiles for OSM `lit`, `tunnel`, `route=bicycle`): settings in the plan sheet's More,
  **For this drive** (vocabulary.js `passenger`, `litRoads`, `cyclists`, `tunnels`, apex.driverPrefs). `passenger_cost` (a
  hairpin 1, a quick left-right 0.6, else the lateral load at the router's speed from 0.25 g to 0.45 g), `tech_level`,
  `skill_fit` (how close the road's technicality is to what your last 12 scored drives' Smooth and Brakes offer, from 5
  drives), `dark`, `lit`, `cyclist_route` and `cyclist_time` (weekend mornings 1), `tunnel`, and **`driver_fit`** (-1..1, the
  preferences that are on; NaN when none is and the skill is unknown), which the engine adds to fun. Passenger aboard also tags
  the recorded drive "Passenger".
- **car.js**: the Garage car's **fuel** and **range** (new fields, migration 0045; "ask once" per car when a 150 km stationless
  stretch meets a car with no range). Stations from OSM `amenity=fuel` (Overpass tiles) or, electric, NLR (ex-NREL, developer.nlr.gov) chargers through
  `GET /api/chargers` (tile ids only; the owner's free key, OWNER_TODO; none = `no-key`). `fuel_since_km`, `fuel_margin`; a
  **`fuel_gap` span with `hard: true`** when a stretch between stations is over the safe range (80 %, EV 75 %), greedy
  `fuel_stop` points, `fuel_check` when the first fuel is past half the safe range (the tank at the start is unknown).
  Signal: `signal` copies builder C's `mobile_coverage` from `opts.peer[id].channels` when the engine passes it; under 0.3 for
  2 km is a `no_signal` span with a `share_eta` point 2 km before it, and `offlineAreas` / `prepareOffline` save those
  stretches' map tiles through offline_tiles.js when the route is chosen. Width and ride height stay in the router costing.
- **ios_context.js** (the app only, on a tap): **My free time** (EventKit, the next event's start only) and **This album**
  (the Music app's now-playing album from the media library; iOS gives no queue) size a time loop (`buildLoop({ minutes })`,
  15-minute steps, 15 min back before the event). Then `free_min` per sample and a `past_next_event` span mark routes that
  would run late, and an `album_ends` point.
- **crew_meet.js**: crew members' rough home areas (crew page switch, off by default, 0.1-degree cells; `GET /api/crews/:id/meet`
  answers the cells without names once two share). **Fair for the crew** on the crew drive form picks the candidate (each
  cell, their centroid and geometric median, and places the caller adds) with the least longest drive + 0.25 x the mean,
  from one Valhalla matrix (crow-fly x 1.35 at 60 km/h when it fails, marked estimated). As a provider, `crew_start` points
  give each candidate route's start its longest crew-mate drive, so a crew loop can start where it is fair.

Every provider respects `budgetMs` and `opts.signal`, aborts its lookups past the budget, caches per tile, and returns
`unavailable`, `partial` or `no-key` instead of throwing. Tests: tests/test_route_ctx_*.py and backend/test/route_context.test.ts.

## Checked

- tests/test_fun_route.py: scoring, junction turns, budgets, corridor shortlist, matrix plans, and
  the app's `funRoute` with stubbed routers (quick, no tiles, Valhalla down, stage wins, all down).
- In a desktop browser against the public servers (2026-10-28): Knoxville → Maryville area with
  Fun: the stage detour won (Fun 79, 128 min, +30 min) over the quickest (Fun 51, 98 min); Max
  fun took a 143 min route (Fun 91). Not yet driven on a phone.
