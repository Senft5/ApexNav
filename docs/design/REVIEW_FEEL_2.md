# Vetta in time, second pass: what the evening's build fixed, what it moved, what it missed

Reviewer: Fable (design and performance), 2026-10-30, late evening, on `claude/beautiful-mendel-l4i1n8` at e06ff25, a few
hours after REVIEW_FEEL.md (ce2a3c9). All 18 findings were built in between (CALL_SHEET "2026-10-30 (evening)").

**How I looked.** The same rig as this morning, deliberately: headless Chromium as an iPhone 15 Pro (393 x 852 at 3x,
touch), `web/` served as `e2e/smoke.js` serves it, the shell's bridge stubbed, CPU throttled 4x, the real OpenFreeMap
style, glyphs, sprites, vector tiles and AWS terrain replayed from the same disk cache at 60 ms / 10 Mbit/s, the owner's
Dry Ridge recording fed through `window.apex.live` at 10 Hz with a fix a second. The morning's scripts re-run unchanged
except where a finding's new behaviour needed a new clock (`car.js` now sends speed and age as `ApexCarPlay.swift` does;
`drive.js` also waits for the score to land); three new probes where a finding needed one (`end_timing.js`: a
MutationObserver on the end card, so the card's arrival is read directly and not through a poller the map can starve;
`terrain_timing.js`; `replay_canvas.js`). Everything is in
`/tmp/claude-0/-home-user-ApexNav/9a2652f3-c166-5611-ac03-2aa60a003319/scratchpad/feel_review_2/` (`*.js`, `*.json`,
`*.log`, screenshots). Every number below is mine, from tonight, against this morning's from the same scripts. "Before"
is this morning's number, "after" tonight's. "Software GL" marks a frame time that includes SwiftShader drawing and is
directional only; pixel counts, script time, long tasks, resizes, bytes and DOM counts transfer to the phone.

**What only the device can tell**, once: the drive's real frame time now that the canvas is 1.0 MP and the contours are
off at speed (F-05); whether the native car map draws at 60 Hz and how much memory three car screens take (F-07); the
shell's main thread with the motion lane on its own queue (F-13); the first Metal shader compile after launch (the 2.6 s
software frame that lands 3 s after the cover here); and the terrain mesh build, which is MapLibre's main-thread work on
any GPU. Section 7 of REVIEW_FEEL.md still says how.

---

## 1. The broad truths

**The chassis is fixed; the instrument now sits on it.** The morning's single most expensive decision, the map as a grid
cell, is gone, and the numbers say so without qualification: **0 map resizes** per tab round trip (was 4), **0 in a 35 s
drive** (was 8), 0 in a replay. People opens in **194 ms** (was 616 to 736), back to Map **76 ms** (was 515 to 596),
"Where to?" **177 ms with no long task** (was 633 to 702 and four), Cancel **87 ms** (was 687), the Log's first open
**126 ms** (was 769 to 916). Those are not improvements, they are a different app: every tap now finishes inside its own
200 ms slide. The end card arrives **109 ms after End** (was 3,852) and its score 325 ms later. After a session of tabs,
the plan sheet, three themes and terrain the page holds **2,648 nodes and 468 listeners** (was 4,950 and 4,968): sheets
are reused, as they should have been. The Log is flat: **889 to 946 ms from 1 to 25 drives, 15 MB of heap** (was 1.25 to
3.4 s and 93 MB, with a 2.4 s task). The car's drawn arrow is **2.7 m behind the true car at the median, 8.8 m at p95**
(was 11 and 25), and at 22 m/s a 133 ms software frame *is* 2.9 m, so what remains of the median is this rig's frame,
not the glide. Nothing asks Google for fonts. These were the cures I asked for and they are cures.

**Three of the fixes are patches, and two of them made something worse.** First, *the launch split stopped at the
social group*: 85 scripts and **1.97 MB of JavaScript still run before DOMContentLoaded** (was 99 and 1.70 MB plus 458 KB
inline); only 310 KB (16 files) moved to `lazy.js`, and it loads anyway 300 ms after the first idle, building its sheets
into the DOM without a tap (897 nodes at the cover, **2,578** a few seconds later; this morning 1,909 after settle). DCL
went from 2.1 to 2.3 s to **0.96 to 1.22 s** and the cover from 4.2 to 4.7 s to **2.8 to 3.2 s**; the targets were 1.0
and 2.0. The honest gain is real (the inline script is now `cockpit.js`, which WebKit can bytecode-cache, and the cover
lifts on the first styled tile instead of the last), but the first 8 s after the cover carry **13 long tasks, 4.2 s**,
exactly this morning's 12 and 4.4: the work was moved past the cover, not removed. Second, *terrain* was deferred "to
idle", and when you are standing still idle is now: the **1.57 s** mesh task starts **30 ms after the tap**, then four
more of 0.8 to 1.0 s; **5.2 s of long tasks** where there were 3.5. Third, *the fixed stage draws the whole window*, and
only a `live` drive trims it: in a replay, and the instant you press End, the canvas is **1179 x 2556, 3.0 megapixels at
3x**, of which **43 % lies under the strip and the binnacle** (the stage cell is 393 x 486); this morning's grid cell was
2.0 to 2.6 MP. The replay's software frame went from 150 to **250 ms** at the median; End is followed by frames of 283
to 417 ms as the map resizes from 1.0 to 3.0 MP while the trail is fitted. The drive itself is the opposite story,
**786 x 1292, 1.02 MP** (was 2.0 MP), contours and ten label layers off above 8 m/s, software p50 **100 ms** (was 167 to
200), which is the acceptance line I set, reached exactly and no further; hillshade alone is still a third of the frame
(67 ms without it).

**The main thread is clear where the driver looks, except in two places.** End, "Where to?", the themes' demo, the Log:
all off the critical path. Left on it: building a planned route from a place pick, **3.5 s with 16 long tasks (3.1 s)**
at 4x, the elevation and sight passes in `route_loading.js` and a 405 ms frame applying the worker's answer; and the Log
when you come to it the way a driver does, after a drive, **1.55 s with a 298 ms first frame**, because the frame is
pre-warmed only at the launch idle and a drive cancels that.

**The car question is answered in Swift and I cannot measure it here.** `ApexCarMap.swift` is MapLibre Native on Metal,
one engine for every car screen, dead reckoning on a `CADisplayLink` with the same algorithm as `car_glide.js` held to it
by a fixture, the web map kept as the fallback. The structure is the one I asked for. The numbers (one WebContent
process on CarPlay, first draw under 2 s, the arrow at the apex) are the device's to give.

---

## 2. Every finding re-judged

Conditions as this morning: 4x CPU, headless Chromium as iPhone 15 Pro, real map data cached with simulated LTE.
Before → after are medians of my runs unless a range is given.

| ID | Verdict | Before → after (my numbers) | What's left |
|---|---|---|---|
| F-01 Car arrow a second behind | **Fixed** (web path; Swift path on device) | Drawn-arrow lag 11.1 m p50 / 25.1 p95 → **2.7 m p50 / 8.8 m p95** at the recording's 20 to 25 m/s (`car.json`); a 133 ms software frame at 22 m/s is 2.9 m, so the median is the rig's frame. Messages from the shell 0.3 ms mean, unchanged | p95 target was 5 m: the 0.8 s ease into each new fix and speed changes between fixes account for the rest; the Swift `CarGlide` is the same code (fixture-held) but its lag on a head unit is a camera measurement (REVIEW_FEEL §7.4) |
| F-02 The map is a grid cell | **Fixed** | Resizes per Garage round trip 4 → **0**; per 35 s drive 8 → **0**; per replay: 0. People 616 to 736 ms → **194 ms** (1 long task, 67 ms); Map 526 → **76**; Cancel 687 → **87**; ResizeObserverCallback gone from every tap's frame (`render_count.json`, `interact.json`) | Nothing of F-02. Its side effect is F-19: the fixed stage is the whole window at 3x outside a `live` drive |
| F-03 The launch carries the whole app | **Partly** | DCL 2.1 to 2.3 s → **0.96 to 1.22 s**; cover 4.2 to 4.7 s → **2.8 to 3.2 s** cached, 4.5 → **3.4 to 3.5 s** offline (DCL + the 2.5 s cap, as before); at 1x 2.05 → 1.45 s. Pre-cover long tasks 3.8 to 3.9 s → **2.5 to 3.0 s**. Inline script 458 KB → **0** (`cockpit.js`, 495 KB, 435 to 513 ms to evaluate at 4x, the biggest single task). Scripts before DCL 99 → **85**, JS 1.70 → **1.97 MB** (+ HTML 597 → 144 KB). Nodes at cover 881 → 897; after settle 1,909 → **2,578** (`boot.json`) | Targets were DCL under 1.0 s and cover under 2 s; only 310 KB moved and it loads at idle anyway (F-23). The cure is the split I described: `cockpit.js` itself into a launch third and lazy sheets, `stages`, `fun_route`, `contributor`, `carplay`, `instruments` on first use (F-24). Bytecode caching: device only |
| F-04 End freezes the screen | **Fixed** | Card 3,852 ms after the tap → **109 ms** (direct clock, `end_timing.json`, 90 s drive); score lands at **434 ms** ("…" until then, correctly); first painted frame 326 → 120 ms (`drive.json`). Long tasks after the tap 20 / 6.3 s → **5 / 1.35 s**, max 603 → 294 | "No task over 50 ms after the card" not met: the 294 ms is the map going back to 3x and the trail fit in the same frame (F-19). A drive too short to keep shows no card and no reason, 25 s drive: "--", nothing saved; say so |
| F-05 The drive draws too much | **Partly** | Canvas 1179 x 1719 (2.0 MP at 3x) → **786 x 1292 (1.02 MP at 2x)**; contours, contour labels and 8 label layers off above 8 m/s, back after 3 s stopped (`AT_SPEED_HIDE`); software p50 167 → **100 ms**, p90 233 → 133, 7.8 → 13.1 fps; `apex.live` p50 4.2 → 3.5 ms, p95 13.3 → 10.3, max 110 → 91; script share 0.05 to 0.07 → **0.08 to 0.10** (shorter frames, same script); placement 8.1 → 9.2 ms a pass (`drive_variants.json`) | Reached the software line (p50 under 100 ms) exactly. Hillshade is still a third of the frame (no-relief p50 **67 ms**). The real acceptance is the device: GPU under 8 ms, main thread under 12 ms per frame |
| F-06 The Log loads every row | **Fixed** | Log open with 1 / 4 / 10 / 25 drives: 1.25 / 1.55 / 2.11 / 3.37 s → **0.89 / 0.88 / 0.91 / 0.95 s**; heap 18 / 26 / 46 / 93 MB → **14.8 / 14.8 / 14.9 / 14.9 MB**; longest task 2,435 → **77 ms**; `nearestIndexWin` gone from the profile (`log_profile.json`) | Target was 400 ms; the 0.9 s left is the page's own load, which the pre-warm hides on the idle path (F-15) and not after a drive (F-21) |
| F-07 A browser per car screen | **Can't tell** | From the code: `ApexNativeCarMap` (MapLibre Native 6.31, Metal) for main, Dashboard and cluster, one tile cache, web map as fallback once per run (`CarPlay/ApexCarMap.swift`, `ApexCarPlay.swift` 672 to 745); `project.yml` carries the package | Everything I asked to count is on the device: WebContent processes with CarPlay connected, first draw time, memory of three `MLNMapView`s, what iOS does to them locked in a pocket. The fallback path still has three browsers if the native style fails |
| F-08 "Where to?" starts discovery | **Fixed** | Sheet open 633 to 702 ms with 4 long tasks (0.9 to 1.4 s) → **177 ms, 0 long tasks**; the heaviest frame a 54 ms focus handler (`interact.json`) | None for the open. The route *build* after a pick is F-20 |
| F-09 Trying a theme loads the demo | **Partly** | No `data/dry_ridge.js` load, no replay started; script inside `tryTheme` 48 to 165 → **25 to 34 ms**; next frame 483 to 711 → **355 to 490 ms**; long tasks 2.2 to 2.5 s → **2.7 to 2.9 s**, now almost all unattributed `FrameRequestCallback` (the 122-layer restyle drawn in software), plus `paintTrial` on a `setInterval` | The one-frame target is not met and most of what is left is the redraw, which only the device can size. What is still script: the full-style restyle rather than the palette's layers, and the trial painter's interval |
| F-10 Terrain blocks the thread | **Not fixed** | Long tasks 3 / 3.5 s, max 1.77 s → **5 / 5.2 s, max 1.57 s**; the first lands **30 ms after the tap** (`terrain_timing.json`): `idle(set)` fires at once on a still map. The switch class flips synchronously; the "Building 3D terrain" note is first painted after the 1.57 s block | The deferral is a no-op when the map is idle, which is when people flip the switch. `setTerrain` is MapLibre main-thread work; the honest fixes are to ease the pitch and paint the note in a frame *before* calling it (a `requestAnimationFrame` pair, not idle), to lower the DEM's max zoom for the mesh, or to accept it and say so. See F-22 |
| F-11 Sheets rebuilt, listeners kept | **Fixed** | After one session (People, Garage, Log, plan + route, Cancel, pan, zoom, 3 themes, terrain): nodes 1,909 → 4,950 became **2,578 → 2,648**; listeners 308 → 4,968 became **409 → 468**; heap 10.5 → 39 MB became 11.4 → 23.6 (`interact.json` metrics) | Within the 10 % I asked for. Heap +12 MB in a session is the map's tiles, not the page |
| F-12 Fonts from Google | **Fixed** | External hosts at launch: `fonts.googleapis.com`, `fonts.gstatic.com`, openfreemap, s3 → **openfreemap, s3**; 17 → 16 external requests; 5 local WOFF2 (`boot.json` requests) | None |
| F-13 The shell's thread discipline | **Can't tell** | From the code: `startDeviceMotionUpdates(to: motion.queue)` on a serial `OperationQueue`; `pushLiveFrame` encodes with `JSONEncoder` on `liveQueue` and returns only the call to main (`ApexNavApp.swift` 516, 1195 to 1250) | Instruments > Time Profiler on the app process while driving (REVIEW_FEEL §7.5) |
| F-14 Replay shares the resize problem | **Partly** | Resizes in a replay: ResizeObserver in every long frame → **0**; layouts/s 9.7 → 6.5 | The replay is now slower in software, 1x p50 150 → **250 ms**, 8x 217 → 283, because it draws 3.0 MP full-bleed where the grid cell drew 2.0 to 2.6 (F-19). `updateNotes` is still per frame at 8x |
| F-15 The Log is a page load | **Partly** | First open from the idle map 769 to 916 → **126 ms** (frame pre-warmed at idle; 253 nodes, 31 scripts, DCL 625 ms inside the frame); again 61 → 63 ms | After a drive, the path that matters, the pre-warm was skipped (`prewarmLog` returns on `live`/`driveActive`) and the Log takes **1,548 ms with a 298 ms first frame** (F-21) |
| F-16 300 ms slides | **Fixed** | Sheets, edge panel, plan: 300 → **200 ms** (`index.html` 216, 744, 808); People fully open at 194 ms, inside the slide | Content leads the slide now because the thread is free; the 120 ms edge panel I suggested was not taken (fine) |
| F-17 The car fetches its own copy | **Partly** | Web car map: requests 38 / 33 → **29 / 25**, bytes 2.36 / 1.81 → **1.97 / 1.53 MB** (hillshade / flat); map loaded at 3.1 s, idle **9.2 to 9.5 s** on LTE (was 8 to 10). Style, glyphs and saved areas now come from the shared `offline_tiles` store (`carmap.js` 299 to 307) | Tiles are shared only inside a *saved* area; no route prefetch; the native map has its own cache, separate from the web's. Target (idle under 3 s with the phone warm) is not reached and, with a native car map, this finding is mostly moot: the car's cache is MapLibre Native's |
| F-18 Heap churn in a drive | **Partly** | Heap growth over 60 s of drive 25.6 → **9.2 MB** before a collection (`drive.json` drive2) | Not flat; steady state is an Instruments measurement over 20 min (REVIEW_FEEL §7.2) |

**Counts:** Fixed 8 (F-01, F-02, F-04, F-06, F-08, F-11, F-12, F-16). Partly 7 (F-03, F-05, F-09, F-14, F-15, F-17, F-18).
Not fixed 1 (F-10). Can't tell 2 (F-07, F-13).

---

## 3. New findings

Regressions first. Same conditions; "software GL" as above.

| ID | Severity | Evidence (measurement or screenshot) | What's wrong | The fix (files) | The number that shows it fixed |
|---|---|---|---|---|---|
| F-19 | P1 (regression) | Replay: canvas **1179 x 2556, 3.01 MP, pixel ratio 3**, container 393 x 852 for a stage cell of 393 x 486, contours visible, 21 symbol layers (`replay_canvas.json`); replay 1x p50 150 → **250 ms**, 8x 217 → 283 (software GL, `drive.json`). End: canvas 786 x 1292 → 1179 x 2556 in one resize at the tap, then frames of 283 to 417 ms while the trail is fitted (`end_timing.json`). Idle: 3.0 MP where the grid cell was 2.0 to 2.6 | The fixed stage is the whole window, and only `state.mode === 'live'` sets the drive's edges and the 2x cap. A replay, a sim, the end card's fit and the idle map all draw 3x full-bleed, **43 % of it under the strip and the binnacle**. The map never needed to be the window; it needed to stop *changing* size | Set `--map-*` and the 2x cap whenever the camera moves under chrome (replay, sim, End) and keep them after End until the card closes; or simpler, always draw the stage cell plus `MAP_EDGE_MARGIN` and change it only on rotation and when the strip appears (`cockpit.js` `setDriveEdges` 650, `applyPower` 664, `leaveDrive` → `setMode`) | Canvas at or under 1.1 MP in replay and for the End fit; 0 resizes at End; replay 1x software p50 back under 150 ms |
| F-20 | P1 | Pick a place → route card: **3,533 ms, 16 long tasks, 3,093 ms**, max 497; the frames: four to five `route_loading.js` `Response.arrayBuffer.then` chains of 60 to 236 ms, then a **405 ms** frame applying `analysis_client.js`'s answer (`interact.json` routeDraw). GPX import of the 57 km road 2.38 → 1.45 s, long 1.11 → 0.82 s | The route's elevation and sight passes decode tiles and walk the line on the main thread, and the worker's result is applied in one frame. The card arrives whole and late; the morning's "Planning" paragraph still stands | Move the elevation/sight passes into `analysis_worker.js` (it already scores and saves; give it `route`), post the card's numbers as they land (length and time first, then climb, then sight), apply the geometry in a `requestAnimationFrame` slice (`web/route_loading.js`, `web/analysis_client.js`, `cockpit.js` `buildRoute`/`renderRouteCard`) | Route card with length and time under 800 ms of the pick at 4x; no main-thread task over 100 ms while it fills |
| F-21 | P1 | Log after a drive (the driver's path): **1,548 ms to the frame, first painted frame 298 ms**, 16 long tasks 4.2 s (`drive.json` logOpen); from the idle map the same tap is 126 ms. `prewarmLog` returns when `state.mode === 'live'` or `driveActive` and is asked only once, after the launch idle (`cockpit.js` 3127, 6463). The drive's page afterwards: 25 long tasks, 7.3 s (this morning 20 / 5.7 s), partly the parent's 3x map behind it (F-19); the rig cannot separate the two frames | The pre-warm covers the demo and not the drive: anyone who starts driving within a few seconds of launch, which is everyone with CarPlay, pays the full Log load the first time they open it, and End is the moment they do | Pre-warm again on the first idle after `leaveDrive` (the card is up, the thread is free), and let `ApexLogHost.changed('drives')` reach a frame that is loading rather than reload it (`cockpit.js` `prewarmLog`, `leaveDrive`) | Log open under 200 ms when tapped from the end card |
| F-22 | P2 (regression) | Terrain: 3 long tasks 3.5 s → **5 long tasks 5.2 s**; the 1.57 s mesh task at **+30 ms**, then 854, 780, 958, 1,037 ms as DEM tiles arrive; "Building 3D terrain" first paints at **1.6 s**; `map.getTerrain()` set at the same moment (`terrain_timing.json`) | `applyTerrain(later)` waits for `moveend` then `idle()`, and a still map is idle at once, so nothing is deferred and the note is painted *after* the block it was meant to cover. More long tasks than before because the mesh is now built from the stopped view and rebuilt as each DEM tile lands | Yield two frames before `setTerrain` so the switch, the note and the first pitch frame paint (`requestAnimationFrame` x2, not `idle`); lower `exaggeration` rebuilds nothing, but a lower DEM `maxzoom` for the mesh does; and keep the note until the first idle after the last DEM tile (`cockpit.js` `applyTerrain` 690 to 712) | Note and switch painted within 50 ms of the tap; one mesh task, not five; total under 2 s at 4x |
| F-23 | P2 | The 8 s after the cover lifts: **13 long tasks, 4.16 s** (this morning 12 / 4.36 s) (`interact.json` afterCover); ten of 160 to 325 ms between 1.3 and 3.8 s after the cover (`terrain_timing.json`); nodes 897 at the cover → **2,578** without a tap; a 2.6 to 2.8 s unattributed `FrameRequestCallback` frame about 3 s after the cover at 4x (577 ms at 1x), software GL's first full draw (`boot.json` loafTop) | "Lazy" means 300 ms after the first idle for everyone: the social group (16 files, 310 KB) loads, runs and builds its sheets, the Log frame boots, the map finishes its first draw, all in the window where a driver's first tap lands. The launch *looks* done 1.3 s earlier and *is* done at the same time | Load the social group on first use, or at idle only when the account has a live convoy or friends sharing (a flag the session already returns); build no sheet until opened; give the Log pre-warm a 5 s quiet window after the last input, not 300 ms after idle (`web/lazy.js`, `cockpit.js` 3729, 6463) | 0 long tasks over 100 ms in the 5 s after the cover without a tap, at 4x; nodes under 1,000 until the first tap |
| F-24 | P2 | 85 scripts and **1.97 MB** of JavaScript before DCL; `cockpit.js` 495 KB, **435 to 513 ms** to evaluate at 4x (the largest pre-cover task), `vendor/maplibre-gl.js` 803 KB; pre-cover long tasks 2.5 to 3.0 s; DCL 0.96 to 1.22 s against a 1.0 s target, cover 2.8 to 3.2 against 2.0 (`boot.json`) | The split moved the inline script to a file and 310 KB to a group. Everything in `cockpit.js`, settings, account, plan, road page, end card, replay, themes, the Log host, still evaluates before the map can exist, with `stages`, `fun_route`, `contributor`, `carplay`, `instruments`, `recording` beside it. This is F-03's cure, not yet done | Split `cockpit.js` along its own section headers: a launch file (map, camera, deck, strip, drive loop, bridge, roughly a third) and `type=module` sheets imported on open; move the planning stack (`route_loading`, `stages`, `fun_route`, `route_card`, `plan_presets`) behind "Where to?" and `recording`/`end_line` behind Start; keep the deferred list under 40 files (`web/index.html` 23 to 121, `web/cockpit.js`, `web/lazy.js`) | DCL under 0.8 s at 4x; pre-cover long tasks under 1.5 s; under 1.0 MB of script before the cover lifts |
| F-25 | P3 | Drive DOM writes 247 → **395 mutations/s**, layouts 4.2 → 6.8/s, style recalcs 7 → 13/s, with the frame rate 7.8 → 13.1 fps (`drive_variants.json`); per frame the writes are the same | The gauges, strip and status are written per animation frame, so a faster map means more DOM work, not less; on a 60 Hz device that is 1,800 writes a second for values that change ten times a second | Write the gauges from the 10 Hz live frame (they already have the value then), and let `cameraFrame` touch only the camera (`cockpit.js` `renderLive`, `cameraFrame`) | Under 100 mutations/s in a drive at any frame rate |

Not re-opened, said once: map pan and zoom-out gestures are unchanged in software (pan p90 233 ms; one 3.2 s frame
on a two-level zoom-out: new tiles for two levels, placement, all drawn in SwiftShader). Nothing in the page changed
there; whether an A17 feels it is the device's answer.

---

## 4. Verdict

**Does it feel instant now?** On the thin shell, yes, for the first time: every tap I can time lands inside its own
200 ms slide, the Log and End no longer freeze, and nothing is rebuilt. The owner's phone will tell whether the drive
does, but the page gave it the best chance it could: half the pixels, a quarter fewer label layers, a canvas that never
resizes mid-drive. **What is not instant is the first five seconds and the second time you ask for something big.**
The cover lifts at 3 s instead of 4.5, and then the page spends another 4 s digesting a launch that is still the whole
app, so the driver's first tap, usually Start, lands in that. A planned route still takes 3.5 s to become a card.
Terrain still holds the thread, now a little longer. And the fixed stage, the best single change of the day, was
finished only for `live`: outside a drive the map draws a 3 MP window under the chrome, so the replay the owner uses to
check a road is slower than this morning and End resizes the map in the frame the card arrives.

**Against Apple Maps, Google Maps and Waze.** This morning Vetta was a generation behind on time feel. Tonight it is
level on the things those apps are judged by between drives: sheets, tabs, search, cancel, the trip's end card. It is
still behind on cold open (they show a usable map under a second; Vetta at 3 s on this rig, and the honest native
figure will be better but not threefold), on building a route (they stream the first result in under a second), and on
anything 3D. On the car it has, in code, what they have (a native map and a predicted arrow), unproven on a head unit.
Where it was ahead, the roadbook, the gauges, the themes, it still is, and the fixed stage finally lets those be seen
without the map re-laying itself under them.

**The next three things.**

1. **Finish the stage** (F-19, with F-14 and F-04's tail): draw the stage cell plus margin in every mode, cap at 2x
   whenever the camera moves, keep the edges through End until the card closes. A day's work; it undoes the one regression
   that touches the owner's daily check (replay) and the proudest moment (End).
2. **Finish the launch** (F-24, F-23): split `cockpit.js` into the launch third and lazy sheets, put the planning stack
   behind "Where to?", stop loading the social group at idle for everyone. A week; it is the only item that moves DCL
   under 1 s and empties the 4 s after the cover.
3. **Measure on the device, then decide the phone's map** (F-05, F-07, F-13, F-10): Web Inspector Timelines for 30 s of
   the Dry Ridge replay and 30 s of a real drive with the page as it is tonight (1.0 MP, contours off), Instruments on
   the car with CarPlay connected, Time Profiler on the shell. If the drive's GPU frame is over 8 ms with hillshade,
   the next move is hillshade off at speed; if the main thread is over 12 ms, it is MapLibre Native under the cockpit,
   which the evening's car work has now made a known quantity.

Then F-20 (the route built in the worker), F-21 (the Log pre-warmed after End) and F-22 (terrain's two frames) in that
order; each is a morning.
