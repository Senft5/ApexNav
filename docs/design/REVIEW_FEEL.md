# Vetta in time: how it feels from cold open to the end of a drive

Reviewer: Fable (design and performance), 2026-10-30, after the owner's first real CarPlay drive and the day's fixes
(da89b7d, 52c98a8). Repository at ce2a3c9 / fb34c79 (main moved under me while I measured; nothing here depends on it).

**How I looked.** Every number in this review is mine, measured today, unless it says "from the code". The rig: headless
Chromium 1.63 (Playwright) as an iPhone 15 Pro (393 x 852 at 3x, touch), `web/` served the way `e2e/smoke.js` serves it,
the shell's bridge stubbed the way the smoke tests stub it, the CPU throttled 4x (the repository's convention for an
iPhone's WebKit under load), and the **real** OpenFreeMap style, sprites, glyphs, vector tiles and AWS terrain tiles,
fetched once and replayed from disk with 60 ms of latency and 10 Mbit/s so the waterfall is honest. The drive is the
owner's own Dry Ridge recording (`web/data/dry_ridge.js`, 57 km, 11,451 rows) fed through `window.apex.live` at 10 Hz
with a new fix every second, as `ApexNavApp.swift` feeds the page. Scripts, traces, JSON and screenshots are in
`/tmp/claude-0/-home-user-ApexNav/9a2652f3-c166-5611-ac03-2aa60a003319/scratchpad/feel_review/` (`boot.js`,
`interact.js`, `drive.js`, `drive_variants.js`, `car.js`, `log_profile.js`, `render_count.js`, `sheet_render.js`).

**What this rig cannot tell you**, said once here and again where it matters: this Chromium has no GPU. WebGL runs in
SwiftShader, on the CPU, so anything the map *draws* is counted in my frame times at a cost that is nothing like an
A17's. Frame times with the map moving are therefore directional only, never a prediction of the phone. What transfers:
bytes, parse and evaluation time, JavaScript per frame, layouts and style recalcs, DOM writes, how often and how big the
map is asked to draw, network waits, and the shape of every long task. Section 7 says how to get the rest on the device.

---

## 1. The critique

### The broad truths

**Vetta is a very good instrument bolted to a slow chassis.** The roadbook strip, the dial, the drum, the car's plates:
these are drawn with more care than anything in Apple Maps. But the thing that carries them is one 597 KB HTML file
(458 KB of script inline, 97 KB of CSS inline) that loads **99 synchronous scripts, 1.70 MB of JavaScript, before the
body can exist**, builds every sheet of the app into the DOM at once (1,900 nodes before you touch anything), and then
asks a WebGL map to redraw itself each time a sheet opens, a tab changes, a status line wraps or the notes strip gains a
line. At 4x throttle the page reaches DOMContentLoaded at **2.1 to 2.3 s** (median of 3 runs; 0.9 s at 1x), and the cover
lifts at **4.2 to 4.7 s**. Offline it lifts at 4.5 s, which is just the 2.5 s cap in `boot.js` running out, because the
cover waits for a map that cannot draw. The owner's "2.5 s" start-up is the cap, not the app.

**Today's fixes were correct and they were the easy half.** Before da89b7d the camera loop nudged the map 60 times a
second standing still; now it is quiet: I count **0 map renders a second** idle, with a fix, under People, under the
Garage, under the plan sheet, and 0 camera jumps. The strip and gauges are written only on change. Those were real
wins and the measurements confirm them. But in a drive, with those fixes in, **JavaScript is 5 to 7 % of the main
thread at 4x** (`ScriptDuration` share 0.046 to 0.07; layout 0.5 to 1 %; style 2 to 4 %; `TaskDuration` share 1.05, the
thread saturated). What is left is not script. It is *drawing*: a 1179 x 1719 to 2166 pixel canvas (2.0 to 2.6
megapixels at 3x), pitched 42 to 48 degrees, 122 style layers of which 26 are symbol layers, hillshade plus contour
lines plus contour labels, redrawn on every frame the spring camera moves, with symbol placement (8 ms a pass at 4x)
on the main thread. Whether an A17 draws that at 60 Hz I cannot tell from here; the owner's phone says "laggy", and
the only measurement that settles it is Web Inspector on the device (section 7). But any further hour spent trimming
JavaScript in the drive loop is an hour chasing 5 %.

**The map is a grid cell, and that is the single most expensive decision in the page.** `#app` is a CSS grid whose
middle row is the map; the strip above it and the binnacle, status line and tab bar below it all change height, and
when they do, MapLibre's ResizeObserver fires and the whole map re-lays out and re-renders. I count **4 map resizes for
one Garage-and-back round trip**, **8 resizes in a 35 s drive** (the container went 393x590, 573, 579, 563 as the
status line and strip changed), and a resize inside every tab tap (`maplibre-gl.js` ResizeObserverCallback, 32 to 87
ms of script each at 4x, plus the redraw). This is why every tap on the tab bar feels heavy: People opens in 616 to 714
ms with 4 to 5 long tasks totalling 0.94 to 1.13 s; back to Map 515 to 596 ms with 0.83 to 0.90 s of long tasks;
"Where to?" 633 to 702 ms; Cancel on the plan sheet 687 ms with 1.16 s of long tasks. The Garage, which does not resize
the map as much, opens in **113 to 187 ms**. That gap is the resize. A navigation app's map is a fixed, full-bleed layer
that never changes size; everything else floats over it and tells the camera its padding. Apple Maps, Google Maps,
Waze: none of them re-layout the map when a sheet opens.

**The first screen is a lie of omission, and the lie costs more than the truth would.** The launch screen, the shell's
lockup and the page's cover are the same dark panel with the same mark (U-80, nicely done), so the cut is invisible.
But behind it the phone parses 597 KB of HTML (764 ms at 4x), compiles and evaluates 2.5 MB of script (971 ms, of which
the inline script alone is 639 ms), builds 2,000 DOM nodes, restyles 122 map layers, and then waits for 13 tile and
terrain fetches (927 KB) and three font files from Google before it will show you the map. There is no reason a driver
who opens the app to *drive* should wait for the Crew page's livery editor, the build-thread composer, the year review,
the QR code library, the g2p phonemizer or the dashcam encoder to be parsed. The best native apps feel instant not
because native is magic but because the launch path carries only the launch.

**Nothing moves before the work is done.** The first frame after a tap lands in 15 to 59 ms (good: `press.js` fixed
the dead-finger problem), but then the screen holds still until the sheet is built and the map has resized. There is no
sheet sliding while content fills, no skeleton, no optimistic state. "End" is the worst: **3.85 s from the tap to the
end card at 4x, with the first frame 326 ms after the finger** and 20 long tasks totalling 6.3 s (the recording is
parsed and profiled on the main thread, saved to IndexedDB, the map fitted, the card drawn). The most emotional moment
of the app is a frozen screen.

**The car gets a browser per screen and a view of the past.** CarPlay's base view is a second WKWebView running a second
MapLibre; the Dashboard is a third; the instrument cluster a fourth (`ApexCarMapViewController` per role). Each is its
own WebContent process with its own workers, tiles and GL context, while the phone's cockpit keeps running. With the
phone locked in a pocket, that is three browsers rendering vector maps at once. And what they render is one fix behind:
the glide (52c98a8) eases to the newest 1 Hz fix "never ahead of real data", which means the arrow sits where the car
was. I measured the drawn arrow **11 m behind the true car at the median and 25 m at the 95th percentile** at the
recording's 20 to 25 m/s. Every shipping navigation app dead-reckons between fixes along the road; a car that trails
its own icon into a corner is the opposite of a co-driver. The owner's call ("never ahead of real data") is a data
honesty principle applied to the wrong thing: the *position* is not road data, and the driver can see the road.

**Work no one asked for.** Tapping "Where to?" starts stage discovery for "Loop from here" (`route_loading.js`
arrayBuffer tile fetches and `analysis_client.js` worker replies: 4 long tasks, 0.9 to 1.4 s at 4x) while the sheet
is trying to open. Trying a theme loads the 1.8 MB demo drive script and starts a replay (179 ms of script, then 10 to
12 long tasks totalling 2.2 to 2.5 s before the theme is on; the next frame comes 483 to 711 ms after the tap). The Log
renders all four of its views (`renderAll`: drive, history, segments, compare) on every open, whichever one you asked
for, and loads every row of every drive from IndexedDB to list their names: 1.65 MB of JSON per 57 km drive, 93 MB of
heap with 25 drives. Switching on 3D terrain costs 3.5 s of long tasks with one of 1.77 s. The shell delivers 100 Hz
CoreMotion samples to the **main** queue (`startDeviceMotionUpdates(to: .main)`), the same thread that drives
`evaluateJavaScript` and UIKit. Fonts come from Google on every launch (U-47, still open). After one session of taps the
page had grown from 1,909 to 4,950 DOM nodes and from 308 to **4,968 event listeners**: sheets are rebuilt, not reused.

### From cold open to End, in order

- **Cold open.** 2.1 to 2.3 s to DOMContentLoaded at 4x, cover up until 4.2 to 4.7 s. Trace at 4x offline: parse HTML
  764 ms, script compile+eval 971 ms, style 229 ms, layout 216 ms, 2,015 nodes. The long task list before the cover
  lifts: 13 tasks, 3.9 s, including one unattributed task of 2.2 s that does **not** shrink at 1x (2.5 s), which marks
  it as GPU-side work in Chromium (SwiftShader compiling the map's programs on first draw). The phone will have its own
  version of that moment (Metal shader compilation through ANGLE on first draw); only the device can size it.
- **The idle map.** Quiet, as it should be: 0 renders a second, 0 camera jumps, standing still with a fix. The scroll in
  the Garage: p50 16.7 ms, no long tasks. The page is capable of smoothness when nothing resizes the map.
- **Tabs and sheets.** People 616 to 714 ms; Garage 113 to 187 ms; back to Map 515 to 596 ms; Log (first) 769 to 916
  ms, Log (again) 55 to 66 ms; "Where to?" 633 to 702 ms; Cancel 687 ms. Each number is finger to the state the tap
  asked for, at 4x. The sheet's CSS transition is 300 ms, so even a free tap takes a third of a second to arrive;
  Things and Linear use 150 to 200 ms and let the content lead.
- **Planning.** With the router stubbed at 600 ms, a GPX route of the 57 km road took 2.4 s to become a track at 4x
  with 1.1 s in long tasks (the elevation and sight passes in `route_loading.js`, then the worker's result applied on the
  main thread). The progress line is honest ("Routing..."), but the card arrives whole and late rather than number by
  number.
- **The drive.** `apex.live` costs 4.2 ms at the median, 13 ms at p95, 110 ms at the worst frame (a status-line and
  strip rewrite), at 4x. DOM mutations 220 to 390 a second. The map container resized 8 times in 35 s. Heap +25 MB over
  a 60 s stretch before a collection (the baseline after GC is unknown; a long drive should be watched in Instruments).
  Frame times p50 167 to 200 ms are SwiftShader's, not the phone's.
- **The strip and the voice.** The lead is computed from speed, reaction and `THINK_S` (from the code), and the strip is
  rewritten in place; 2 spoken lines and 3 `voiceBegin` in 90 s of road. The timing logic is sound; the latency that
  matters is clip start in `ApexClipPlayer`, which creates and `prepareToPlay`s an `AVAudioPlayer` per clip at say time
  (from the code: fine for short clips, not measured here).
- **End.** 3.85 s to the end card, first frame at 326 ms, 20 long tasks, 6.3 s. Saving a 57 km drive costs 1,130 ms of
  main-thread parse (`ApexRecording.parse` at 4x) and writes 1.65 MB to IndexedDB.
- **The Log and the drive page.** One 57 km drive: Log 1.25 s, drive page 1.17 s (a 436 ms IDB read and a 364 ms
  draw). 4 drives: 1.55 s. 10: 2.1 s with a 1.17 s task. 25: 3.4 s with a **2.4 s single task**, 93 MB of heap; the
  profile is `nearestIndexWin` (1.13 s: every drive matched against every other for the coach and the compare) and the
  IndexedDB read (0.5 s). A year of weekly drives will take the Log past 5 s at 4x and keep 180 MB of rows in memory to
  show a list of names.
- **Replay and the scrubber.** Render-bound in this rig (p50 150 ms at 1x speed, 217 ms at 8x), so no phone number. The
  scrubber drag itself costs little script (6 ms a pointermove); the frames are the map's.
- **The car.** `carmap.html` has its map loaded at 2.6 to 3.1 s and idle (tiles in) at 8 to 10 s on the simulated LTE,
  over 33 to 38 requests and 1.8 to 2.4 MB. Messages from the shell cost 0.3 ms mean, 1.5 ms p95 (52c98a8 did its job).
  The arrow trails the true car 11 m p50 / 25 m p95. Hillshade makes a software frame 50 % longer (p50 150 vs 100 ms);
  that ratio, not the number, is what to expect from a GPU too: a full-screen raster pass over a 1600 x 960 canvas.

---

## 2. The diagnosis, ranked by how much of the slowness each explains

1. **The map is laid out, not layered** (explains most of "every tap feels heavy", and part of the drive). Evidence:
   4 resizes per tab round trip, 8 per 35 s drive, `maplibre-gl.js` ResizeObserverCallback in the long frame of every
   tab, sheet and Cancel tap (32 to 87 ms at 4x each, before the redraw); People 616 to 714 ms against the Garage's 113
   to 187 ms. Files: `web/index.html` (`#app` grid, `.stage`, `#app.sheet-open` and `#app.live` rules, 140 to 383).
2. **The launch path carries the whole app** (explains the cold open and the first minute's sluggishness: the main
   thread is still digesting while you tap). Evidence: 99 sync scripts, 1.70 MB + 597 KB; parse 764 ms, eval 971 ms at
   4x; DCL 2.1 to 2.3 s; 2,000 nodes before first paint; 17 external requests before the cover lifts, fonts among them.
   Files: `web/index.html` lines 23 to 121 and 1415 to 7472; `web/boot.js`.
3. **The map draws too much, too big, too often in a drive** (explains "generally laggy" on the road, pending the device
   measurement). Evidence: canvas 2.0 to 2.6 MP at 3x, pitch 42 to 48, 122 layers / 26 symbol layers, hillshade +
   contours + contour labels, placement 8 ms a pass at 4x, every frame while the springs move; script only 5 to 7 % of
   the thread. The in-page low-power mode (30 fps, 2x pixels, no relief) cut the software frame from 167 to 67 ms p50;
   2x pixels alone to 100 ms; no relief alone to 117 ms. Files: `web/index.html` map creation (1660 to 1770), `applyPower`
   (1982), `cameraFrame` (2069).
4. **Heavy work on the main thread at the moments that matter** (explains End, the Log, themes, terrain). Evidence:
   End 3.85 s with 6.3 s of long tasks; `ApexRecording.parse` 1,130 ms for 57 km; Log `renderAll` draws four views;
   `nearestIndexWin` 1.13 s at 25 drives; `tryTheme` loads the 1.8 MB demo; terrain 3.5 s. Files: `web/index.html`
   (`endDrive`, `tryTheme`, terrain toggle), `web/analysis.html` (`renderAll`, `coachFor`, `loadDrives`),
   `web/recording.js`.
5. **The car is fed the past through a browser** (explains "unusable" beyond the stutter 52c98a8 fixed). Evidence: 11 m
   p50 / 25 m p95 lag; three WKWebViews on car screens (from the code); car map first idle 8 to 10 s on LTE. Files:
   `CarPlay/ApexCarPlay.swift` (`ApexCar.position`, `ApexCarMapViewController`), `web/carmap.js` (`glide`).
6. **The shell's own thread discipline** (from the code; unmeasured): 100 Hz CoreMotion on the main queue;
   `pushLiveFrame` builds a JSON string by concatenation and `evaluateJavaScript`s it 10 times a second; `DriveJournal`
   writes per fix. Files: `ApexNavApp.swift` 1305 to 1320, 1091 to 1145.

---

## 3. The overhaul question

**Is a web view inside a shell a ceiling?** For the chrome, no. A WKWebView with a small DOM, a free main thread and
no layout coupling to a canvas can feel as quick as SwiftUI; the Garage scroll at a steady 16.7 ms and the 0-render idle
show the page can be quiet when it is allowed to be. The craft of this product (the roadbook, the gauges, three themes
with their voices) lives in that web layer, and it is the part the owner iterates on daily. Rewriting it native would
cost months and buy back little that the fixes below do not.

For the **map**, yes, there is a ceiling, and it has three walls. One: MapLibre GL JS shares the page's main thread for
everything but tile parsing (placement, source updates, camera, GL command issue), so the map and the UI contend. Two:
WebGL in WKWebView goes through ANGLE to Metal at a 3x canvas; MapLibre Native draws through Metal directly, with its
own render thread. Three: on CarPlay each screen is a browser process, which is memory the phone will reclaim when it is
locked in a pocket, and which WebKit throttles in the background (the shell already has to opt out with
`inactiveSchedulingPolicy = .none`).

**What to rebuild, what it buys, what it costs.**

- *Do not rebuild* the phone's chrome. Restructure it: a launch bundle of roughly the map, the deck, the drive loop and
  the strip (~300 KB), everything else as modules loaded on first use. Fix the stage. Buys: DCL under a second at 4x,
  taps that finish in the transition's time. Cost: a week, mostly moving code, no new behaviour.
- *Rebuild the car's map natively first.* MapLibre Native (iOS, Metal) takes the same style JSON, the same tiles, DEM
  and hillshade, the same theme palettes (`basemap.js restyle` becomes a style-expression pass in Swift), and gets
  route line, plates, puck and sight tag as native annotations. Dead reckoning lives in Swift on a `CADisplayLink`
  (position = last fix + speed x course x elapsed, snapped to the route line). Buys: no WebContent process per car
  screen, no background throttling question, a GPU-paced 60 Hz car map, and an arrow where the car is. Cost: two to
  three weeks for one engineer; `carmap.js` is 20 KB and `ApexCarMapViewController` already speaks a small message
  set (look, route, corners, hazards, position, sight, mode, zoom, pan, recentre, inset), which is the interface to
  keep. The web `carmap.html` stays as the Android Auto and website path.
- *Decide the phone's map on device data.* If Web Inspector shows the drive under ~12 ms of main-thread time a frame
  and the GPU under 8 ms after the web fixes (fixed stage, 2x canvas in a drive, contours off at speed), keep MapLibre
  GL JS. If not, put MapLibre Native under a transparent WKWebView and bridge camera, padding, taps, route and pins: the
  page already treats the map as a black box behind `map.*` calls, which makes this a two to four week job, not a
  rewrite.

**My recommendation:** do the week of web fixes now (needed under every option), rebuild the car's map natively next
(it is where "unusable" was and where three browsers are a liability), and measure the phone before deciding its map.
Do not start a native rewrite of the cockpit.

---

## 4. Verdict

Against Apple Maps, Google Maps and Waze, Vetta's road feel, notes and instruments are richer than any of them, and its
time feel is a generation behind: they show a usable map in under a second and never freeze on a tap; Vetta shows a
dark panel for two to four seconds, holds still for half a second on most taps, freezes for nearly four on End, and
draws its own car a second late on the head unit. Against the fastest-feeling apps (the original iPhone's scrolling,
Things, Linear, Flighty) the difference is not frames per second, it is whether anything ever waits on anything it did
not need: Vetta waits on the whole app to open the map, on the map to open a sheet, on the Log's four views to show one,
on the demo drive to try a theme. Three things stand between it and feeling instant: **a map that never changes size**,
**a launch that carries only the launch**, and **nothing heavy on the main thread when the driver is looking** (End,
the Log, themes, the car's position). The architecture is not the ceiling for the first two; for the third the car's
map should go native now and the phone's map should be judged on the device.

---

## 5. Findings

Conditions unless stated: 4x CPU throttle, headless Chromium as iPhone 15 Pro, real map data cached with simulated LTE.
"Software GL" marks a number that includes SwiftShader drawing and is directional only.

| ID | Severity | Evidence (measurement or screenshot) | What's wrong | The fix (files) | The number that shows it fixed |
|---|---|---|---|---|---|
| F-01 | P0 | Car arrow 11 m p50 / 25 m p95 behind the true car at 20 to 25 m/s (`car.js`, `car.json` lagM); `glide` eases to the last fix "never ahead" | On the head unit the car is drawn where it was a second ago; it enters corners after the real car does. Unsafe as a guide to where you are | Dead-reckon in Swift: from the last fix, advance along the route (or along course) by speed x elapsed on a display link, correct toward each new fix; send the pose, not the fix (`CarPlay/ApexCarPlay.swift` `ApexCar.position`, `ApexNavApp.swift` `pushLiveFrame`; `web/carmap.js` `glide` becomes a 100 ms smoother) | lagM p95 under 5 m in `car.js`; on the car, the arrow at the apex when the car is |
| F-02 | P1 | 4 map resizes per Garage round trip, 8 per 35 s drive (`render_count.json`, `drive_variants.json` resizes/sizes); `maplibre-gl.js` ResizeObserverCallback 32 to 87 ms in every tab tap's long frame; People 616 to 714 ms vs Garage 113 to 187 ms | The map is a grid cell sized by the strip, status line, binnacle and sheets; every change re-lays out and redraws a WebGL map | Make `.stage` a fixed full-bleed layer under everything; sheets, strip and binnacle overlay it; tell the camera its padding (`map.setPadding`) instead of resizing (`web/index.html` `#app` grid 140, `.stage` 205, `#app.sheet-open` 799 to 806, `cameraFrame` top padding 2100) | 0 `resize` events per tab round trip and per drive; People open under 250 ms at 4x |
| F-03 | P1 | DCL 2.1 to 2.3 s, cover 4.2 to 4.7 s at 4x; 99 sync scripts, 1.70 MB JS + 597 KB HTML (458 KB inline script); parse 764 ms, eval 971 ms (`boot.json` traces) | The launch parses and evaluates the whole app, including crews, builds, QR, g2p, dashcam, year review, before the map can exist | A launch bundle (map, deck, drive loop, strip, themes) and `type=module` lazy imports for sheets and features on first open; move the inline script out of the HTML so WebKit can cache its bytecode; `defer` everything not needed before first paint (`web/index.html` 23 to 121, 1415+) | DCL under 1.0 s at 4x; cover lifts under 2 s with tiles cached |
| F-04 | P1 | End: 3.85 s to the end card, first frame 326 ms, 20 long tasks 6.3 s (`drive.json` end); `ApexRecording.parse` 1,130 ms for 57 km (`log_profile.json` save) | The recording is parsed, profiled, curvature-computed and scored on the main thread after the tap; the screen freezes at the drive's proudest moment | Show the end card at once with the name, distance and time; parse and score in `analysis_worker.js` (already exists) and fill the score when it lands; checkpointed rows mean the parse can start before End (`web/index.html` `endDrive`/`showEndCard` ~6870 to 6990, `web/recording.js parse`, `web/analysis_client.js`) | End card visible within 150 ms of the tap; no main-thread task over 50 ms after it |
| F-05 | P1 | Drive: script 5 to 7 %, task share 1.05; canvas 1179 x 1719 to 2166 at 3x; 122 layers, 26 symbol; placement 8.1 ms; software GL p50 167 ms shipped, 100 ms at 2x pixels, 117 ms no relief, 67 ms in low-power mode (`drive_variants.json`) | In a drive the page's cost is the map's drawing, not its script; a 2.6 MP pitched canvas with relief and contours is redrawn every frame the camera moves | In `live` mode: pixel ratio 2 (the car already caps at 2), contours and contour labels off above ~8 m/s (hillshade kept), fewer symbol layers (hide POI and minor road labels while driving), and `fadeDuration: 0` is already set (`web/index.html` `applyPower` 1982, `HEAVY_LAYERS` 1979, `startDrive`) | On the device: GPU under 8 ms and main thread under 12 ms per frame in a drive (Web Inspector Timeline); in this rig, software p50 under 100 ms |
| F-06 | P1 | Log with 25 x 57 km drives: 3.4 s, one task of 2.4 s, 93 MB heap; `nearestIndexWin` 1.13 s, IDB read 0.5 s; `renderAll` draws four views on every open (`log_profile.json`, `web/analysis.html` 1127) | The Log loads every row of every drive to list names, and matches every drive against every other before showing the list | Keep a summary store (id, name, date, km, score, corners, bbox) and read rows only for the drive opened; render the view asked for, the others on demand; run coach/compare in `analysis_worker.js` (`web/analysis.html` `loadDrives` 388, `renderAll` 1127, `coachFor` 1086; `web/recording.js` `all`) | Log open under 400 ms at 4x with 25 drives; heap under 30 MB on the list |
| F-07 | P1 | Three `ApexCarMapViewController`s (main, dashboard, cluster), each a WKWebView + MapLibre (from the code, `CarPlay/ApexCarPlay.swift` 584 to 640); car map first idle 8 to 10 s on LTE, 1.8 to 2.4 MB | Each car screen is a browser process rendering its own map while the phone is locked; memory and background scheduling are at iOS's mercy | MapLibre Native (Metal) map view in the CarPlay base views, same style and tiles, apex layers as native annotations; one tile cache shared with the phone (section 3) | One WebContent process while driving on CarPlay (Instruments > Activity Monitor); car map first draw under 2 s |
| F-08 | P1 | "Where to?" tap: 633 to 702 ms, 4 long tasks 0.9 to 1.4 s, `route_loading.js` arrayBuffer and `analysis_client.js` worker replies in the frame (`interact.json`) | Opening the plan sheet starts stage discovery and tile fetches for the suggested loop, on the main thread, as the sheet tries to open | Open the sheet first (transition end), then discover; decode tiles in the worker that already scores them; cache the suggestion per position (`web/index.html` `openPlan` 4414, `renderPlaces` 4543, `web/route_loading.js`, `web/stages.js`) | Sheet open under 200 ms; no long task until it is open |
| F-09 | P2 | Theme switch: next frame 483 to 711 ms, 10 to 12 long tasks 2.2 to 2.5 s, `data/dry_ridge.js` onload 179 ms (`interact.json`); screenshot `int_tapedeck.png` shows the replay started | Trying a theme loads the 1.8 MB demo and starts a replay; applying one restyles 122 layers and rebuilds the cluster synchronously | Restyle only the layers the palette touches (keep a list from the first pass); defer the demo until the trial is confirmed or the map idle; swap the cluster after the colour transition (`web/index.html` `tryTheme` 5767, `applyTheme` 1607, `web/basemap.js restyle`) | Theme applied in one frame under 100 ms at 4x; no script load on Try |
| F-10 | P2 | Terrain on: 3 long tasks 3.5 s, max 1.77 s (`interact.json`) | `setTerrain` blocks the thread while the DEM mesh is built; the switch gives no feedback | Toggle the switch and ease the pitch first; enable terrain on the next idle; show "building terrain" in the Layers key (`web/index.html` 5977 to 5992) | No task over 100 ms on the tap; switch state visible at once |
| F-11 | P2 | DOM 1,909 to 4,950 nodes and 308 to 4,968 listeners after one session of tabs, plan, three themes and terrain; heap 10.5 to 39 MB (`interact.json` metrics) | Sheets and pickers are rebuilt with fresh listeners and old nodes kept; a long day in the app grows the page | Build each sheet once, update in place; delegate listeners to the sheet root; audit `renderThemePicker`, `renderAccount`, People and Garage builders (`web/index.html`, `web/garage_ui.js`, `web/crew_page.js`) | Listeners within 10 % of launch after a session; nodes flat |
| F-12 | P2 | 17 external requests before the cover lifts, 3 font files and a Google stylesheet among them (`boot.json` requests); U-47 open since REVIEW3 | Every launch asks Google for fonts; a slow network means a fallback font behind the cover and a swap after | Bundle Barlow Condensed and Inter Tight as WOFF2 with `font-display: optional` in the app (`web/index.html` 16 to 21, `web/boot.js`, THIRD_PARTY_NOTICES) | 0 requests to fonts.googleapis.com / gstatic.com at launch |
| F-13 | P2 | `startDeviceMotionUpdates(to: .main)` at 100 Hz; `pushLiveFrame` string-builds JSON and `evaluateJavaScript`s at 10 Hz (`ApexNavApp.swift` 1305 to 1320, 1091 to 1145; from the code) | The IMU pipeline, journaling and the bridge share UIKit's main thread with WebKit's UI process work | Run the pipeline on an `OperationQueue` (CoreMotion supports it) and hand the main thread a ready frame; encode with `JSONEncoder` once; consider `WKScriptMessage` reply instead of `evaluateJavaScript` for the 10 Hz push | Main-thread time in Instruments under 2 ms per 100 ms while driving |
| F-14 | P2 | Replay 8x: `tick` + `cameraFrame` + ResizeObserver in long frames (`drive.json` replay8x); scrubber pointermove 6 ms but the strip and status cause resizes | The replay's camera and the live camera share the resize problem (F-02); at 8x the strip rewrites every frame | Covered by F-02; also throttle `updateNotes` to 4 Hz at rates above 2x (`web/index.html` `tick` 2844, 2840) | No resize during replay; p50 frame at 8x within 20 % of 1x in software |
| F-15 | P2 | Log (first) 769 to 916 ms; the frame loads 30 scripts and builds 1,835 nodes; second open 55 to 66 ms (`interact.json`) | The Log is a second page in an iframe; its first open is a page load, and it is thrown away when the theme, units or a drive change | Keep it, but pre-warm the frame at idle after launch (hidden), and update its theme and drives through `ApexLogHost` messages instead of marking it stale (`web/index.html` `openLog` 4383, `ApexLogHost.stale`) | First Log open under 150 ms at 4x; no reload after a drive |
| F-16 | P3 | Sheet transition 300 ms, plan 300 ms, edge 300 ms (`web/index.html` 224, 293); first frame 15 to 59 ms after a tap | Even a free tap takes 300 ms to arrive; the ease is the same for a 60 px bar and a full sheet | 180 to 220 ms for sheets, 120 ms for the edge panel, with the content filled before the slide starts; keep 300 only for the drive-ended card | Sheet fully open 220 ms after the tap when the main thread is free |
| F-17 | P3 | Car map: 33 to 38 requests, 1.8 to 2.4 MB, idle at 8 to 10 s on LTE (`car.json`) | The car fetches its own copy of the style, glyphs, sprites, tiles and DEM the phone just fetched | Share the `offline_tiles.js` IndexedDB cache between the pages (same origin: it already can) and prefetch the route's tiles when a route is set (`web/carmap.js`, `web/offline_tiles.js`) | Car map idle under 3 s with the phone's cache warm |
| F-18 | P3 | Heap +25 MB over a 60 s stretch of drive before a collection (`drive.json` drive2.heapGrowthMB); baseline after GC unmeasured | Per-frame allocations (frame objects, strip notes, ribbon features) churn the heap; on a 3-hour drive this is GC pauses and thermal load | Reuse the frame object and typed arrays in `recordFrame`/`updateRibbon`; measure in Instruments (section 7) before tuning further | Steady-state heap flat over a 20 min replay on the device |

---

## 6. Roadmap, in build order, grouped by shared code

1. **The fixed stage** (F-02, F-14): `.stage` full-bleed, overlays with padding, camera padding instead of resize.
   Expected: tab and sheet taps from 500 to 700 ms to under 250 ms at 4x; no mid-drive resizes; the replay's long
   frames halve. One PR, mostly CSS and the `cameraFrame` padding.
2. **A launch that carries the launch** (F-03, F-12): inline script out to `cockpit.js`, lazy modules for People,
   Garage, Builds, QR, g2p, dashcam, year review, convoy, crews; fonts bundled. Expected: DCL from 2.2 s to under 1 s at
   4x; cover off before the tiles rather than after the whole app.
3. **A drive that draws less** (F-05): pixel ratio 2 and contours off in `live`, fewer labels at speed, placement
   measured on device. Expected: pixels per frame down 56 %, symbol layers down by a third; the on-device frame time is
   the acceptance test.
4. **Nothing heavy while the driver looks** (F-04, F-08, F-09, F-10): the end card first and the score from the worker;
   the plan sheet before discovery; themes without the demo; terrain on idle. Shared code: `analysis_client.js` gets a
   `parse`/`score` job. Expected: End under 150 ms to a card, Where to? under 200 ms, themes in one frame.
5. **The car's position and its map** (F-01, F-07, F-17): dead reckoning in Swift this week (small, high value), then
   MapLibre Native in the CarPlay base views. Expected: arrow lag under 5 m; one WebContent process on CarPlay; car
   map draw under 2 s.
6. **The Log that scales** (F-06, F-15): summary store, one view rendered, coach in the worker, the frame pre-warmed
   and messaged. Expected: Log under 400 ms at 25 drives; heap under 30 MB.
7. **The shell's threads and the page's churn** (F-13, F-11, F-18): pipeline off the main queue, sheets built once,
   frame objects reused. Expected: measured on device only; the targets are in the table.
8. **Motion polish** (F-16): shorter, content-first transitions once 1 to 4 have freed the thread.

---

## 7. On the device

Chromium answered what it could; these are the measurements that settle the rest, in the order they pay.

1. **The drive's frame, Safari Web Inspector > Timelines** (a Debug build has `isInspectable`; the phone on USB, Safari
   > Develop > the phone > Vetta). Record 30 s of a replay of Dry Ridge at 1x (`?drive=dry_ridge&play=1`) and then 30 s
   of a real drive with `APEX_REPLAY` in the shell. Read: Frames (the per-frame bar: script, layout, paint, composite),
   JavaScript & Events, and the Rendering Frames FPS. Targets: script under 4 ms, layout 0, composite under 8 ms, no
   frame over 33 ms. Then the same with pixel ratio 2 and contours off (F-05) to see what each buys on the GPU.
2. **GPU and memory, Instruments**: Metal System Trace (GPU time per frame while the map moves; the WebContent process
   is the one to pick), Allocations on WebContent over a 20 minute replay (steady-state heap, F-18), Activity Monitor
   with CarPlay connected (how many WebContent processes, their memory, F-07; what the system does to them when the
   phone locks).
3. **Cold open, Instruments > App Launch**, plus Web Inspector's Network and Timelines from `didStartProvisionalNavigation`
   to `ApexBoot.done`: how long the parse and evaluate of `index.html` takes in JavaScriptCore (compare to 764 + 971 ms
   at 4x here), whether bytecode caching is happening (it will not for an inline script), and the time to the first
   styled map draw (the GPU-side task I could not attribute).
4. **The car's lag with a camera**: film the head unit and the road at a known mark (a stop line, a sign) at a steady
   speed; count frames between the car passing the mark and the arrow reaching it. Before F-01 I expect about a
   second; after, under a tenth.
5. **The main thread of the shell, Instruments > Time Profiler** on the app process while driving: the share of the main
   thread in `ingestMotion`, `pushLiveFrame`, `DriveJournal.add` and `evaluateJavaScript` (F-13). Under 2 % is fine; over
   10 % competes with WebKit's input handling.
6. **Battery**: a two-hour drive with the phone on the mount, Settings > Battery afterwards, with and without CarPlay;
   and the thermal state the app already reports in frames (`thermal`), logged. Pair with 2 to see which process heats.

## Pushback (once)

- *"The car map is never ahead of real data"* (CALL_SHEET 2026-10-30). Position is not road data. Dead reckoning
  between 1 Hz fixes is what every navigation app does and what a driver expects; a trailing arrow is the less honest
  picture of where the car is. F-01 keeps the honesty where it belongs (camber, roughness, crests are never guessed).
- *"Turning contours off in a drive would change the look."* It would, at speed, where no one reads a contour label.
  Keep hillshade (the relief reads), drop the lines above 8 m/s, bring them back when stopped. The car already made
  this call and it was right.
- *Pixel ratio 3 on the phone.* The car caps at 2 for "no sharper a glance"; the same is true of a map scrolling under
  a dial at road speed. Cap the map's canvas at 2 in `live`; keep 3 for the idle map and planning if the device
  measurement says it is free.
