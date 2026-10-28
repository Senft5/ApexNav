# Idea backlog

The long list of everything that could make ApexNav best in class. It is a menu, not a
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
| impact | **H** changes why someone picks ApexNav over another app, or removes a reason to leave. **M** clearly better day to day. **L** nice, niche or polish. |
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
| R-12 | Set list: order stages so intensity builds, rests, and finishes high; no three max-TECH stages in a row | M | M | todo | ROAD_INTELLIGENCE §7.2.5 |
| R-13 | Sun glare penalty for headings within 20° of a low sun, using the existing solar formula | M | S | done (#123) | ROAD_INTELLIGENCE §7.2.6 |
| R-14 | Re-score the router's returned geometry and reject routes that shortcut a stage | M | S | todo | ROAD_INTELLIGENCE §7.2.4 |
| R-15 | Avoid options: highways, tolls, ferries, unpaved, towns, repeated roads, with honest "couldn't avoid" | H | M | done (#118, #136: towns as a ranking cost; repeated roads were already a loop cost, A→B plans never repeat a stage) | Kurviger, Calimoto, Google Maps |
| R-16 | Time budget routing: "I have 90 minutes, end at home" (orienteering with a hard time cap) | H | M | done (#122: 1 h / 2 h loops planned on drive time) | ROAD_INTELLIGENCE §7.1 |
| R-17 | Day trip builder: start, stops (food, fuel, viewpoint), finish, with drag-to-reorder vias | H | L | todo | Roadtrippers, Calimoto tour planner |
| R-18 | Drag the route line on the map to reshape it (adds a via) | M | M | todo | Google Maps, Kurviger |
| R-19 | Archetype preferences in routing ("love esses, skip switchbacks"), sliders first, learned later | H | M | partial (Plan → Hairpins fewer/more and Sweepers fewer/more weigh each route's fun, fun_route.js cornerWeight, ±60%; learning it from your choices is R-33) | ROAD_INTELLIGENCE §5.4 |
| R-20 | Car-aware routing from the Garage (width, ride height, power: no goat tracks for a lowered car) | M | M | todo | SOCIAL §2.4 |
| R-21 | Weather-aware routing: penalise wet, icy, foggy or very hot stages from a free forecast; show why | M | M | todo | Calimoto weather, REVER |
| R-22 | Seasonal and time-of-day closures (OSM `conditional` tags, seasonal mountain passes) | M | M | todo | Kurviger |
| R-23 | Fuel and charge range: warn before a long stage with no fuel; EV charger stops on loops | M | M | partial (fuel stations from the map along a planned route; the route card warns of 50+ mi with none; EV chargers and the car's range still to do) | Google Maps, ABRP |
| R-24 | Scenic layer: viewpoints, overlooks, waterfalls and car-friendly cafés along the route from OSM | M | M | partial (web/scenic.js + stages.js pois: OpenStreetMap viewpoints and cafés within reach of a planned route pinned on the map and counted on the route card, e.g. \"7 viewpoints · 1 café\" over Newfound Gap; waterfalls and car-friendly picks still to do) | Roadtrippers, Scenic |
| R-25 | GPX import (follow someone's route with our notes) and GPX/KML export of planned routes | M | S | done (Plan → Open GPX: a track is followed as drawn with our notes, route points or waypoints are routed through; route card → GPX exports the planned route; web/route_import.js) | Kurviger, Calimoto, REVER |
| R-26 | Open a shared route link from Google/Apple Maps or a GPX in the app ("Open in ApexNav") | M | M | done (paste a Google Maps, Apple Maps or geo: link into Where to?: its start, stops and destination; \"Open in ApexNav\" for .gpx files from Files, Mail and AirDrop. Short maps.app.goo.gl links must be opened in a browser first) | Waze deep links |
| R-27 | Our own routing graph with fun scores baked into edge costs (Valhalla custom costing) | H | XL | todo | ROAD_INTELLIGENCE §7.3 |
| R-28 | On-device Valhalla with regional tiles built monthly by free CI, so routing works with no signal | H | XL | todo | ROAD_INTELLIGENCE §7.4, Calimoto offline |
| R-29 | Lane guidance and junction views at complex interchanges on the transit parts of a trip | M | L | todo | Google Maps, Apple Maps |
| R-30 | Multiple route options shown side by side on the map with Fun/Twist/Flow and time for each | H | M | done (#126) | Google Maps alternatives |
| R-31 | "Why this route" explainer: the stages it uses, what each adds, and what it cost in minutes | M | S | done (#115) | trust-building |
| R-32 | Benchmark roads (Tail of the Dragon, Big Sur, Stelvio, Route 33) must rank in their region's top decile; CI test | M | M | todo | ROAD_INTELLIGENCE §6.2 |
| R-33 | Preference learning: after a drive, "which was better, A or B?" fits per-user and global weights | H | L | todo | ROAD_INTELLIGENCE §6.3 |
| R-34 | Ramp/cloverleaf loops no longer read as Switchbacks (veto motorway links by road class) | M | S | todo | STATE 2026-10-25 (c) |
| R-35 | Avoid known speed traps and ALPR cameras as a routing option, not only a note | M | S | todo | DeFlock layer, Waze |
| R-36 | Crowd quiet hours: prefer stages that are empty at the time you'll arrive (from anonymous counts) | M | L | todo | Strava heatmap, Google popular times |
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
| D-10 | 3D flyover replay of a drive with the corner notes and g trace (export as a video) | H | L | todo | Relive |
| D-11 | Dashcam overlay: sync a phone/GoPro video with the drive and render g, notes and score over it | M | L | todo | RaceRender, Track Addict |
| D-12 | OBD-II over Bluetooth LE: throttle, brake, RPM, gear for true inputs instead of inferred ones | H | L | todo | Track Addict, RaceChrono |
| D-13 | External GNSS (10–25 Hz) support for better lines and lap timing | M | M | todo | RaceChrono, Dragy |
| D-14 | Performance timing: 0–60, 60–0, quarter mile, only on a closed course with a clear warning | M | M | owner (safety stance) | Dragy |
| D-15 | Track day mode: closed circuit, start/finish line, sector splits, laps, no public-road guardrails needed | H | L | todo | Harry's Lap Timer, RaceChrono |
| D-16 | Fatigue cues: rising corrections, later braking and wider lines late in a long drive, suggest a break | M | M | partial (#108 post-drive; live break cue; wider lines todo) | car driver-attention systems |
| D-17 | Incident detection: a crash-level spike plus stop asks "Are you OK?" and can alert a chosen contact | H | M | done (web/incident.js: ≥6 g while moving, at rest within 15 s, still 8 s; a minute unanswered shows Call 911/112 and a text with your location to the contact, which the driver sends. Native frames carry impact_g from the 100 Hz IMU) | Apple Crash Detection, Life360, REVER |
| D-18 | Line analysis: early vs late apex per corner from the GPS line against the road geometry | M | M | partial (turn-in from lateral g vs your quicker pass, this thread; lane position needs better than phone GPS, D-13) | SOCIAL §3 |
| D-19 | Car-specific reference lap from the Garage so scores mean the same across cars | H | M | todo | SOCIAL §2.4 |
| D-20 | Weekly drive digest: km of good roads, new roads, best moment, one thing to work on | M | S | todo | Strava weekly, Whoop |
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
| Q-03 | Pace-normalised corner deviation: hidden difficulty where everyone slows more than geometry predicts | H | M | todo | ROAD_INTELLIGENCE §4.1 |
| Q-04 | Geometry correction: crowd yaw-rate curvature overrides simplified OSM corners | H | L | todo | ROAD_INTELLIGENCE §4.2 |
| Q-05 | Adaptive sectors by change-point detection, broken at junctions | M | M | todo | ROAD_INTELLIGENCE §5.3 |
| Q-06 | Durable upload queue that survives page navigation and app restarts (IndexedDB) | H | M | partial (road-queue, unintegrated) | WORKER_QUEUE road-1, road-queue |
| Q-07 | End-to-end verification of open app → upload → profile → routing change on preview data | H | M | todo | WORKER_QUEUE road-4 |
| Q-08 | Upload crest with the right sign and range (resolve crest semantics with the server's 0..3) | M | S | partial (#65) | ARCHITECTURE §1 |
| Q-09 | Sight offset per corner from landcover (forest vs field) instead of a constant 4 m | M | M | todo | STATE 2026-10-25 (c) |
| Q-10 | Surface type from vibration spectrum (asphalt, chip seal, concrete joints, gravel) | H | L | todo | ROAD_INTELLIGENCE §3.4 |
| Q-11 | Wet/low-grip zones from repeated traction events and weather at the time | M | L | todo | Waze hazards |
| Q-12 | Freshness: decay old measurements, flag repaved roads when a rough road suddenly reads smooth | M | M | todo | Waze, ROAD_INTELLIGENCE §4.3 |
| Q-13 | Road pages: archetype, four axes, confidence L0/L1/L2, elevation, notes, verified hazards, best direction and season | H | M | todo | SOCIAL §2.2, Kurviger/REVER road ratings |
| Q-14 | Coverage map: which roads are measured, by how many passes, and where pioneers are needed | M | S | todo | Strava heatmap, Mapillary coverage |
| Q-15 | Hazard reports by hand (one tap: pothole, gravel, debris, animal, police, closure) with auto-expiry | H | M | done (this PR: Report key in the drive bar, six kinds, expiry by kind, nearby reports pinned and called ahead in your direction; migration 0011) | Waze |
| Q-16 | "Still there?" prompts when you pass a reported hazard, to confirm or clear it | M | S | done (this PR: after passing one in your direction, 'still there?' with Still there / Gone; two 'gone' outvoting confirmations end it) | Waze |
| Q-17 | Road closure and construction from OSM and crowd reports, fed into routing | M | M | partial (reported \"Road closed\" hazards within the trip's box go to the router as exclude_locations; no way around: routed anyway with a warning. OSM construction tags still to do) | Waze, Google Maps |
| Q-18 | Native C++ core (`/core/cpp`) so iOS and Android share one implementation instead of Swift duplication | M | XL | todo | ARCHITECTURE, STATE 2026-10-25 |
| Q-19 | Benchmark road calibration set scored from map + DEM, checked in CI | M | M | todo | ROAD_INTELLIGENCE §6.2 |
| Q-20 | Archetypes by clustering once crowd data exists | M | L | todo | ROAD_INTELLIGENCE §5.2 |
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
| V-06 | Celebrity/character voice packs as cosmetic Octane rewards | M | M | todo | Waze voice packs |
| V-07 | Voice commands: "report pothole", "skip this stage", "how far to the next stage" (Siri Shortcuts first) | M | M | todo | Waze, Google Assistant |
| V-08 | Music ducking tuned per note priority; never duck for low-priority notes in cruise | L | S | todo | — |
| V-09 | Recce mode: drive slowly once, the co-driver writes your own notes for the road and reads them next time | H | L | todo | rally recce |
| V-10 | Remove espeak-ng (GPL) from the voice path before charging | M | M | todo | docs/VOICE.md |
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
| S-07 | Kudos and comments on shared drives and highlights | M | M | todo | Strava kudos |
| S-08 | Local legends without speed: most passes of a stage this month, smoothest crew | M | S | todo | Strava Local Legends |
| S-09 | Pioneer badges for first measured passes of a road (3× Octane already designed) | M | S | todo | SOCIAL §2.3, Waze points |
| S-10 | Octane redemptions that buy nothing safety-related: cosmetics, voice packs, early features | M | M | todo | SOCIAL §2.3 |
| S-11 | Challenges: "drive 5 new roads this month", "pioneer 10 km", crew-vs-crew km | M | M | todo | Strava challenges, REVER |
| S-12 | Highlights feed near you: viewpoints, cafés, meets, saved by members | M | M | done: Crew → Spots near you (`web/spots_feed.js`): members' spots best rated then nearest, category chips, Go there, 1/3/5★, Report; meets are S-13 | Roadtrippers, Google Maps contributions |
| S-13 | Car meets map: public events and recurring Cars & Coffee, added by crews | H | M | partial (a public crew lists a drive as a meet; Crew → Meets near you within 80 km, join the crew to answer; migration 0015. Recurring meets and pins on the map are still to do) | car meet apps, Facebook groups |
| S-14 | Invite links that open the app (or the web) on the crew or route | H | S | done (custom scheme; Universal Links later) | growth |
| S-15 | Profiles: handle, cars, crews, favourite roads, totals; private by default | M | M | todo | Strava profile |
| S-16 | Block and report on every social surface; moderation queue for public crews and highlights | H | M | done (#120) | App Store requirement for UGC |
| S-17 | Pairwise "which road was better?" after a drive feeds road scores (and is fun) | M | S | todo | SOCIAL §2.2 |
| S-18 | Photos on highlights and stops, stripped of EXIF location beyond the highlight | M | M | todo | Roadtrippers, Google Maps |
| S-19 | Live share ETA with a friend or family ("Nate is 12 min away") without sharing the drive | M | M | done (route card → Share ETA: a link to web/eta.html with the handle, minutes left and arrival time, refreshed each minute while driving, ended on arrival or Stop; no position, route or destination; migration 0016) | Apple Maps Share ETA, Life360 |
| S-20 | Flyby: after a drive, see which friends drove the same road that day (opt-in) | L | M | todo | Strava Flyby |
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
| U-05 | Audit the live cockpit with simulated GPS frames at phone size (day, night, glare) | H | S | done (this PR: browser GPS track, day and night; native frames and glare still need a phone) | STATE 2026-10-28 UI audit |
| U-06 | Stages simplified: one list near you with your best and the leader, create from a drive in one step | H | M | partial (#77) | WORKER_QUEUE stages-1 |
| U-07 | Glanceable cockpit: one number and one note readable at arm's length in sunlight | H | M | partial (drive bar: big Rec mileage, problems only; lead pace note 32 px distance, 21 px call, 56 px tulip) | car HMI guidelines |
| U-08 | Motion design pass: route reveal, sheet springs, note transitions, under 200 ms, reduced-motion respected | M | M | partial (pace notes slide on in 160 ms when one is passed) | Apple Maps |
| U-09 | Haptics on notes and hazards (subtle, configurable) | M | S | done (this PR: a light tap on each pace note, a warning pattern on hazards, via the shell's Taptic Engine; Haptics switch, on by default) | Apple Maps turn haptics on Watch |
| U-10 | Home screen and lock screen widgets: nearby best stage, last drive score, crew event | M | M | partial (a Start-a-drive widget for the home and lock screen and a Control Center button on iOS 18, opening apexnav://open?go=drive; widgets with data (last score, next crew drive) need an App Group) | iOS widgets |
| U-11 | Live Activity / Dynamic Island: next note, distance to stage, ETA | H | M | done (ApexNavLive widget extension; the cockpit pushes the next note while a drive runs) | Apple Maps, Uber |
| U-12 | Apple Watch: next note as a tap on the wrist, drive summary | M | L | todo | Apple Maps on Watch |
| U-13 | Map style polish: road character colours (twist, surface) as an optional layer | H | M | partial: Twisty roads switch (map shape); surface todo | Kurviger curvy colours, Calimoto |
| U-14 | 3D terrain with hillshade on the planning map and flyover preview of a route | M | M | todo | Apple Maps, Google Earth |
| U-15 | Dynamic Type and VoiceOver pass on every screen, checked with the iOS simulator | H | M | partial: sheets, Log and Stages follow the text size (up to 1.6x); replay scrubber is a slider; not run in the simulator | accessibility |
| U-16 | Landscape cockpit layout for mounts in landscape | M | M | todo | Waze |
| U-17 | Copy pass to BRAND voice on every remaining string (errors, empty states, permissions) | M | S | partial (#103) | docs/BRAND.md §2 |
| U-18 | Native feel: replace remaining web-looking controls (selects, date inputs) with app-style ones | M | M | partial (selects) | STATE 2026-10-27 |
| U-19 | Search that understands roads and stages ("Tail of the Dragon"), not just addresses | H | M | todo | Google Maps |
| U-20 | Saved places and lists (home, work, favourite stages) synced to the account | M | M | todo | Google Maps lists |
| U-21 | Route preview: scrub along the route with elevation, notes and road character | M | M | todo | Calimoto, Komoot |
| U-22 | Units and locale: km/mi, 12/24 h, left-hand traffic notes | M | M | todo | international launch |

## 7. Onboarding and growth (O)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| O-01 | First run in three screens max, permissions at the moment of need | H | S | done (BRAND §4; polish: no focus ring, Sign in is the one solid button on its step) | docs/BRAND.md §4 |
| O-02 | Mount guide: how and where to mount the phone, with a live "calibrated" tick | H | S | done (app: Mount row before the first drive, "Mount set" when calibration locks) | STATE 2026-10-26 calibration |
| O-03 | Instant value with no account: plan a fun loop from where you are in two taps | H | S | done (loop chips in Where to?) | Calimoto |
| O-04 | Demo replay that shows the cockpit, notes and analysis in 60 s | M | S | partial (#58) | — |
| O-05 | Sign in with Apple (required on iOS when Google sign-in is offered): native provider in the shell, Worker verifies the token, capability enabled through the API key (docs/APP_REVIEW.md) | H | M | partial (this PR: native sheet, Worker verification, entitlement, capability on the App ID; token revocation on account deletion needs the owner's Sign in with Apple key) | App Store guideline 4.8 |
| O-06 | Email link sign-in as a no-Google option | M | S | todo | docs/BACKEND.md |
| O-07 | Referral: invite a friend into your crew, both get Octane | M | S | todo | Waze, Strava |
| O-08 | Landing page with real screenshots, the four promises and TestFlight/Play links | H | S | partial (web/about.html: the pitch, two real screenshots from tools/landing_shots.js, the four promises, what it does, links to the app, a replay, privacy, terms and licences; the public TestFlight link and a contact address wait on the owner; no Play app yet) | launch |
| O-09 | App Store listing: screenshots, preview video, privacy nutrition label, keywords | H | M | partial (text, keywords, age rating and App Privacy answers drafted in docs/LISTING.md; the owner pastes them; screenshots to come) | launch |
| O-10 | In-app "what's new" sheet after an update, one screen | L | S | done (web/whats_new.js: once per release, not on a first install or over a link; edit NEWS and its id when a release adds something drivers notice) | — |
| O-11 | Privacy policy and terms of use pages, linked in Settings and at sign-in, policy URL in App Store Connect; terms carry the no-tolerance rule for objectionable content (guideline 1.2). Drafted from the real data flows, owner approves (Z-07) | H | S | partial (this PR: pages drafted and linked; owner approves the text and the contact line, then the URL goes into App Store Connect) | App Store guidelines 5.1.1(i), 1.2 |
| O-12 | App Review access: a reviewer sign-in path that needs no invite, and review notes (drives need a car; replays show the cockpit) | H | S | partial (this PR: a long-lived review code, only its hash in the repo, makes a reviewer's account a member; the owner pastes the code and notes into App Store Connect) | App Store guideline 2.1 |
| O-13 | Native surfaces that make the app more than a web view (Live Activity, widgets, CarPlay) named in the review notes | M | M | partial (Live Activity, a Start-a-drive widget and Control Center button shipped; CarPlay to come) | App Store guideline 4.2 |

## 8. CarPlay, Android Auto and in-car (C)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| C-01 | CarPlay map template with route, next note and ETA | H | L | owner (Apple account, CarPlay entitlement) | ApexNav mission |
| C-02 | CarPlay notes as a list template and hazard alerts as CPAlert | H | M | owner (Apple account) | Waze CarPlay |
| C-03 | Android Auto navigation template | H | L | owner (Android priority) | ApexNav mission |
| C-04 | Car audio: ducking and routing to Bluetooth/CarPlay while prompts play | H | M | done (#73) | — |
| C-05 | Auto-start: open the cockpit when the phone joins the car's Bluetooth or CarPlay | M | S | done (#152): CarPlay audio route offers "Start drive"; `apexnav://open?go=drive` starts one (Shortcuts automation "When CarPlay connects"). Not yet checked in a car | Waze, Shortcuts |
| C-06 | Driving focus aware: no social notifications while driving, a summary after | M | S | blocked: the app sends no notifications yet; build this with the first push or social alert | iOS Focus |
| C-07 | Big-target in-car mode: every control ≥ 60 pt, no keyboard while moving | H | S | done (#121) | NHTSA distraction guidelines |
| C-08 | Passenger mode: unlocks typing and route editing while moving, with a clear switch | M | S | done (#121) | Waze passenger prompt |

## 9. Offline (F)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| F-01 | Honest offline states everywhere (`--`, "no signal to reroute") | H | S | done (#34, #67) | honesty rule |
| F-02 | Offline region downloads: vector tiles, DEM and road profiles for an area | H | L | todo | Google Maps offline, Calimoto |
| F-03 | Save a planned route for offline: geometry, notes, hazards and profiles cached before leaving | H | M | partial (web/saved_routes.js: Save on the route card keeps shape, directions, router times and limits; Where to? lists it and it opens with no signal, notes worked out on the phone. The planned route also survives an app restart for 12 h. Map tiles need F-02; reported hazards are live only) | Calimoto, Kurviger |
| F-04 | Offline rerouting with on-device Valhalla (see R-28) | H | XL | todo | ROAD_INTELLIGENCE §7.4 |
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
| Y-06 | Staged rollouts: preview Worker for TestFlight, feature flags per build | M | M | todo | docs/BACKEND.md |
| Y-07 | Real-phone test checklist run before each TestFlight build (VERIFY.md) | H | S | done (VERIFY.md section 0; first run is the owner's) | docs/VERIFY.md |
| Y-08 | Record migrations in `d1_migrations` and a drift check in CI | M | S | half (backfilled 0001–0009 on both databases 2026-10-28; CI drift check todo) | STATE 2026-10-26 |
| Y-09 | Database backups (D1 time travel/export) and a restore drill | H | S | done (#124; first export 2026-10-28 via the connector; drill needs the owner's wrangler login) | production readiness |
| Y-10 | Rate limits and abuse protection on every write endpoint | H | M | done (#112) | production readiness |
| Y-12 | Scheduled backups with no token: a Worker Cron Trigger (Mondays 07:00 UTC) dumps every table through the D1 binding into the private `apexnav-backups` KV namespace, keeps the last 8 (docs/BACKUPS.md section 3a). Move to R2 once the owner enables it or a dump nears 24 MiB | H | S | done (this PR; first run the Monday after deploy) | first backup 2026-10-28 |
| Y-11 | End-to-end browser tests of the main flows (plan, drive replay, log, crew) in CI | M | M | done (#148, routed plan stubbed in a follow-up): first run + replay, live cockpit + typing lock, battery saver, search offline, a stubbed routed plan, Log; Crew needs a stubbed Worker API (next) | testing |
| Y-13 | No cron: expired invites, crew invites and app sign-in codes stay in D1 forever (sessions are now swept on the next sign-in, #132). A daily `scheduled` handler that deletes expired rows (can share the Y-12 backup cron) | L | S | done (this PR: daily cron `23 6 * * *`, src/sweep.ts; used account invites kept) | audit 2026-10-28 |
| Y-14 | Segment ids are client-made (`seg_<ms>`) and global: two people saving at the same millisecond get `409 id_taken` and that segment never syncs. Scope ids per owner, or let the server assign and return one | L | S | todo | audit 2026-10-28 |
| Y-15 | `upsertGoogleUser` never refreshes email or display name for an existing account, so a changed Google address stays stale in the export and in `OWNER_EMAIL` matching | L | S | done (this PR: every sign-in takes Google's current email and name) | audit 2026-10-28 |
| Y-16 | Owner screen for crash counts (reads `GET /api/ops/errors`; today only JSON) | M | S | done (this PR: Crew → Errors this week for the owner: count, source, route or page, days, last seen, stack) | crash-log review 2026-10-28 |
| Y-17 | Latency and real error rate where agents can read them: Analytics SQL binding (`logs.workersLogs`, beta) or a daily summary row in D1; or sign in the full Cloudflare connector | H | M | todo | crash-log review 2026-10-28: the connector reaches D1 and Worker code only |
| Y-18 | Count Durable Object (convoy) exceptions in `error_counts` too; today only the Worker's route handler 500s are counted | M | S | done (this PR: convoy socket-frame and alarm failures counted as 'convoy frame' / 'convoy alarm', scrubbed like the rest) | crash-log review 2026-10-28 |

## 11. Performance and battery (P)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| P-01 | Battery budget for an hour of driving with screen on, measured and published | H | M | todo | Waze, REVER complaints |
| P-02 | Low-power cockpit: drop to 30 fps and fewer map layers when the battery is low or hot | M | M | done (#133) | thermal throttling |
| P-03 | Split web/index.html into modules so pages load faster and threads stop colliding | M | L | todo | dev velocity |
| P-04 | Lazy-load voice banks and kokoro-js only when voice is on | M | S | done (already lazy: checked 2026-10-28, a cold start fetches only voices/index.json) | startup time |
| P-05 | Route analysis in a Web Worker so the UI never stutters while scoring | M | M | todo | Y-01 |
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
| Z-08 | Minimum k-anonymity for road bins shown publicly (don't show a bin only one driver touched near a home) | M | S | todo | Strava heatmap lesson |
| Z-09 | iOS web view is `isInspectable = true` in release builds: Safari Web Inspector on a Mac with the unlocked phone plugged in can read the session token from localStorage. Gate it behind `#if DEBUG` or a hidden developer toggle | M | S | done (#143) | audit 2026-10-28 |
| Z-10 | App session token lives in web localStorage; keep it in the iOS Keychain and hand it to the page per request through the bridge | M | M | todo | audit 2026-10-28 |
| Z-11 | Content-Security-Policy beyond `frame-ancestors` (script-src for the inline scripts by hash, connect-src for the map/route hosts): defence in depth now that a session token sits in page storage | M | M | todo | audit 2026-10-28 |
| Z-12 | The outgoing friend-request list shows a pending row only for real member handles, so typing handles still tells you which exist (the request answer itself is uniform). Show sent requests for unknown handles too, or not at all | L | S | done (this PR: the server no longer lists sent requests; the phone shows every handle you sent to alike; cancel by handle answers the same either way) | audit 2026-10-28 |
| Z-13 | Convoy members see each other's Google display name (`who()` in convoy_routes.ts), unlike crews and boards since #132. Send the handle only, or the name only between friends | L | S | done (this PR: handle only, the Google name never enters the convoy room) | audit 2026-10-28 |
| Z-14 | Map matching sends the (trimmed) drive trace with the phone's IP to the public Valhalla demo server, and routing sends start and end points to public servers. Self-hosting (Y-04) fixes both; say it in the privacy policy (Z-07) until then | M | L | owner (cost) | audit 2026-10-28 |
| Z-15 | Crew invite links are multi-use, never revocable and uncapped per owner (account invites are capped at 10 open). Add revoke on the crew card and a cap | L | S | done (this PR: 10 live links per owner, "Turn off invite links" on the crew card) | audit 2026-10-28 |

## 13. Android and web parity (A)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| A-01 | Android shell (WebView + native sensors) reusing the web cockpit like the iOS shell | H | XL | owner (Android priority) | ARCHITECTURE thin shells |
| A-02 | Web: mount calibration in the browser so the web app can share measured road data | M | M | todo | STATE 2026-10-27 |
| A-03 | Web: installable PWA with offline shell and home screen icon | M | S | todo | — |
| A-04 | Place suggestions while typing (Apple search in the app, Photon on the web) | M | S | done (#73) | WORKER_QUEUE plan-suggest |
| A-05 | Desktop planning view: big map, route list, GPX, send to phone | M | M | todo | Kurviger desktop, Calimoto web planner |

## 14. Launch and business (L)

| id | idea | impact | effort | status | from |
|---|---|---|---|---|---|
| L-01 | Apple developer account, TestFlight external beta | H | S | owner (account) | launch |
| L-02 | Zero-subscription model written down: one-time unlock, cosmetic Octane, or donations | H | S | owner (decision) | mission |
| L-03 | Licence audit of every dependency and voice model before charging | H | S | done (THIRD_PARTY_NOTICES.md audit note; web/licenses.html ships the BSD/MIT notices in the app, linked from Settings; the website-only voice engine is never loaded in the app, guideline 2.5.2) | docs/VOICE.md licences |
| L-04 | Attribution for OSM, OpenFreeMap, Valhalla, Nominatim, Photon, DeFlock, Kokoro (Settings → Sources and licences) | M | S | done | licences |
| L-05 | Support channel and feedback button that attaches anonymous diagnostics | M | S | todo | — |
