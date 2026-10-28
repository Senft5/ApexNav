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

## Candidates

1. The router's route (Valhalla, highways and tolls de-prioritised) and up to 2 Valhalla alternates
   (`alternates: 2`). OSRM is the fallback when Valhalla is down.
2. Quick stops there. Fun and Max fun also look for **stages** (web/stages.js: OpenFreeMap vector
   tiles, roads joined into strokes, each stroke's best 2–10 km window scored on corners and
   junctions) in a circle around the A→B midpoint (radius half the trip + 3 km, at most 64 tiles,
   which is about 11–12 km at 40°N). Long trips therefore only get stages in their middle.
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

## Loops

Loops chain stages found around the start. Their length used to come from crow-fly connectors x 1.6,
which ran 40–75 % long in hills (a 45 mi request around Knoxville routed to 99–102 km). Now the best
6 stages that can be reached and returned from are shortlisted (`loopShortlist`), one Valhalla matrix
(13 x 13, sent as two calls of at most 100 pairs) gives real road distances between the start and
every stage end, and `loopPlansFromMatrix` chains 1–3 of them in any order and direction within 25 %
of the target. Same value formula as before (stage score x (1 − length error) − 0.08 per connector
km). The crow-fly plans are the fallback when the matrix fails, and the circle loop is still routed
as a baseline. Checked against the public servers: routed loops now land within about 15 % of the
target (Knoxville 30 mi: 43–44 km after spur removal; 45 mi: 58–62 km; Cincinnati 30 mi: 46–48 km).

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
(`ApexContributor.measuredAdjust`: a rough road costs up to 6 points; unmeasured roads are neutral).

The route card shows Fun / Twist / Flow for a planned route and Twist / Flow / Surface from
measured sectors for a driven one, plus the router's time and "+N for fun" over the quickest.
These are map-derived, never measured road feel.

## Checked

- tests/test_fun_route.py: scoring, junction turns, budgets, corridor shortlist, matrix plans, and
  the app's `funRoute` with stubbed routers (quick, no tiles, Valhalla down, stage wins, all down).
- In a desktop browser against the public servers (2026-10-28): Knoxville → Maryville area with
  Fun: the stage detour won (Fun 79, 128 min, +30 min) over the quickest (Fun 51, 98 min); Max
  fun took a 143 min route (Fun 91). Not yet driven on a phone.
