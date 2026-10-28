# Fun routing

How ApexNav picks the way from A to B (web/fun_route.js, wired in web/index.html `funRoute`), and how
loops are sized (see Loops below; stage discovery itself is web/stages.js and docs/ROAD_INTELLIGENCE.md §7).

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
come from the map tiles (`ApexStages.places`, z9, at most 9 tiles), every candidate (A→B and loops) gets the km it spends
within 4 km of a city, 1.5 km of a town or 0.6 km of a village (`FunRoute.townKm`, 100 m steps; the places you start
or end in don't count), and ranking takes 3 points a km, at most 30. Circles round a point, not the town's real edge.
The card says "Through towns ~N mi" from 1 mi. No place data is unknown and costs nothing. Checked: west Knoxville →
Townsend, the router's route has 10.5 km of town (Alcoa/Maryville) and the card says ~7 mi; there was no town-free
alternate to take.

## Candidates

1. The router's route (Valhalla, highways and tolls de-prioritised) and up to 2 Valhalla alternates
   (`alternates: 2`). OSRM is the fallback when Valhalla is down.
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

## Sun glare

Every candidate (A→B and loops) is driven in time from now over its router time, and each 100 m that heads within
20° of a sun 0–15° above the horizon counts as glare (`FunRoute.glare`, `ApexSun.sunPosition`, NOAA). Ranking takes
1 point per glare minute, at most 20, so a road straight into the setting sun loses a close call but not a much
better road. The route card warns "Low sun ahead for ~N min" from 3 minutes. Checked: Knoxville → west at 5:40 pm in
late October, every candidate has 22–34 min of it and the card says so. Not kept when a route is restored later
(the time has moved on).

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
extra minutes + measured adjustment`, after dropping anything past the level's budget. Fun is a
density, so a long route through a great stage barely moves it; the corner gain is what pays for
the detour. For members, the top candidates also get what others measured on those roads
(see Measured roads below).

The route card shows Fun / Twist / Flow for a planned route and Twist / Flow / Surface from
measured sectors for a driven one, plus the router's time and "+N for fun" over the quickest.
These are map-derived, never measured road feel. When the winner is slower than the quickest route, a line under the bars says
why (`FunRoute.why`, from the router's own road names): the roads it spends 2+ km more on (at most 3), the
good corners it gains and the minutes it costs, e.g. "For SR 360 13 mi, Cold Spring Road 8.2 mi · 167 more
good corners, +30 min".

## Checked

- tests/test_fun_route.py: scoring, junction turns, budgets, corridor shortlist, matrix plans, and
  the app's `funRoute` with stubbed routers (quick, no tiles, Valhalla down, stage wins, all down).
- In a desktop browser against the public servers (2026-10-28): Knoxville → Maryville area with
  Fun: the stage detour won (Fun 79, 128 min, +30 min) over the quickest (Fun 51, 98 min); Max
  fun took a 143 min route (Fun 91). Not yet driven on a phone.
