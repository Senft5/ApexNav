# Dee Martinez, round 2

## 1. First impressions

I live where the bars give out at the mailbox. Most of my week is ridge road with a coal truck in front and a deer in the ditch, and no signal from the first hollow on. So I read Vetta the way I'd read a trail map: what still works when the phone has nothing.

I went through the recording with that question. The app opens and drives with its own pieces. A drive is kept on the phone as it goes (drive_keep.js) and a hazard report waits in an outbox when there's no connection (outbox.js, with its age). That's the right order: the road comes first, the upload later.

Almost everything else needs a network. Every route is built by Valhalla, with OSRM as a second try, and both fail with no signal (cockpit.js:2346, 2616). Explore and loops fail the same way (cockpit.js:3050, 2985). Search only finds my own stages and spots. The map itself is only there if I saved a 25 km circle round the map's centre at a time I had signal (cockpit.js:4717). None of the nine recorded flows was run with signal off. The offline tests in e2e/smoke.js check that a saved map opens (3228), a saved route opens (593) and a hazard report waits (2054). None of them drives a route or a drive with the network gone.

Two things are plain BS. Settings says "Map tiles you have seen are kept by the phone's own web cache, which clears itself" (web/my_data.js:71), while IDEAS F-06 says MapLibre keeps none. The terrain I save is only read by the climb numbers (stages.js:461); the map's own terrain asks S3 directly (cockpit.js:331-384), so my saved area is flat. I found no path from the saved area to the car's map (CarPlay/ApexCarMap.swift:103 uses MapLibre Native's own cache).

Small fixes, after the big picture: unpaved roads are avoided by default for every car (fun_route.js:463, 525). A lifted Tacoma gets the same as a stock one, because the costing only reads "low" ride height. The car I drive is the one the forest roads are for.

## 2. Proposals

### DE-1: Drive your own track when the map has no road for it
- **Why it matters to me.** Drive it again is the only way back to a drive I made on a gravel road the map doesn't show. It needs the router. `driveAgain` (cockpit.js:4906-4925) calls `valhallaRoutes` and on failure says "Couldn't route that drive. Check signal and try again." The drive's own coordinates are right there, and GPX already follows a track as drawn (route_import.js:24, `trackFromPolyline`). I drove that road, so it can be driven again from its own track.
- **What to build.** In `driveAgain`, when the router throws or returns no road, build the route from the drive's own `d.lat`/`d.lon` with `trackFromPolyline`, with the same notes and Sight. The route card says "Following your track as driven". The deck, the drive's page and the end card all call `driveAgain` (cockpit.js:4830, 4852, 6285), so one fix covers all three.
- **Cost:** S
- **Done looks like:** airplane mode on, Drive it again on a drive from a gravel road the map doesn't show runs the drive, with notes, Sight and the time to go. The card says it follows my track, not a mapped route.

### DE-2: One trip pack for the whole route, not a circle at the house
- **Why it matters to me.** A saved area is a 25 km circle round the map's centre at the moment I press the button (cockpit.js:4717; offline_tiles.js `plan`, capped at 2,500 tiles). My ridge loops run 40 to 70 miles, so a circle at home leaves the far end blank. The route card's Save says "the map needs signal" (cockpit.js:2306). Trip prep is split across three places: Save on the route card, "Save the map here" in Settings, and Garage.
- **What to build.** When Save is pressed on a route, also save the map, labels and terrain for a corridor 2 km either side of its shape, using the same zoom ranges as now (map z8-14, terrain z10-12). Show the size first ("about 84 MB for this route. Wi-Fi?") and a line when it's done: "Map saved for the whole route". Keep the circle for the Explore side. The corridor is removed with its route.
- **Cost:** M
- **Done looks like:** at home on Wi-Fi I save a 60-mile route, turn on airplane mode, pick it from Where to?, and the map draws the whole line and 2 km either side. Nothing says "needs signal" on the map.

### DE-3: The car reads the phone's saved copy
- **Why it matters to me.** The car's map is native MapLibre Native (CarPlay/ApexCarMap.swift:103) with its own cache, and there is no offline pack anywhere in the Swift code. The saved area lives in the page's IndexedDB, which the car map never opens. A cold start with no cached style falls back to the web page that does read it (ApexCarMap.swift:179), and that path has not run on a device. The car screen is the one I look at on the mountain.
- **What to build.** Give the native car map an offline pack (`MLNOfflinePack`) built from the same style and tile list DE-2 saves for the route. The car uses the pack when the phone has one for the route on screen.
- **Cost:** M (native; CI compiles it, the device proves it)
- **Done looks like:** airplane mode on the phone, the car's map cold-starts and draws the saved route on its first frame, without the fallback page.

### DE-4: Weak signal fails in seconds, not in turns
- **Why it matters to me.** One bar is the usual case out here, and that is worse than none. The router calls time out after 20 s (route_loading.js:42) and OSRM gets another 20 s, so a reroute can sit on "Rerouting…" for about 40 s before "Off route · no signal to reroute" (cockpit.js:2607-2616). `apiFetch` sets no timeout at all (sync.js:39), so a hazard report on one bar waits for the network stack before it reaches the outbox (cockpit.js:5810). The only reachability check is `navigator.onLine` (cockpit.js:2608), and the Swift shell has no path monitor (no `NWPathMonitor` in the Swift code).
- **What to build.** An 8 s timeout on route, matrix and hazard or answer posts. A reroute that fails on Valhalla gives up at once, rather than trying OSRM after another wait. Add `NWPathMonitor` to the shell and feed it into the same online flag, so the car says "No signal" once, not every minute.
- **Cost:** S
- **Done looks like:** at a one-bar spot, a reroute says "No signal to reroute" within about 20 s, and a hazard report says "saved; it's sent when you have one" within about 8 s.

## 3. Did round 1 land?

Drive it again (D-1) landed for people with signal and fails exactly where I need it: its only path is the router (DE-1). The Sunday suggestion reads map tiles (your_roads.js), so with no saved area the idle plate goes quiet. That's honest, but it means it is dark for me most of the week. End with Undo and the call grammar don't touch the network, and I saw nothing to object to.

## 4. What I'd protect

1. **Drives record first and send later.** The recorder, the journal and the drive score all stay on the phone until there's a connection (drive_keep.js; crew_page.js:233-249). Nothing I need on the mountain can sit behind a network call.
2. **The honest words.** "--" for a limit I don't have, "no signal to reroute", and an outbox that keeps a report with its age (outbox.js, `age_s`). Those are the reason I'd trust the app on a ridge, and they cost nothing to keep.
