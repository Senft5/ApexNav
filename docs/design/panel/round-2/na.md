# NA: Nadia Petrova, iOS performance engineer (Sonnet)

## 1. First impressions

I profile phones for a living, so first the limits of what I can say. Recording 7 ran on a simulator on a CI Mac. Simulator timings are not device timings, and nothing in `app-log.txt` measures launch, first paint, memory, battery or heat. The log holds spoken lines, review events and map style warnings. So I can't hand you a launch number, and the first thing I'd say is that **the app can't hand you one either**. A repo that carries `power.js`, `battery_budget.js`, a thermal guard, a drive journal and a stall detector has no signpost, no MetricKit and no timing line anywhere (grep: zero hits in `ApexNavApp.swift`, `ApexKit/` and `web/`). The owner's "laggy" report on 2026-10-30 was fixed by reading code. Nobody can show it stayed fixed.

The videos. `guided-drive/phone.mp4` is variable frame rate: 19,364 frames in 1,281 s. Per wall-second, 712 s sit at 12-24 fps, 298 s at 4-11 and 84 s at 1-3. `tapedeck-night` is healthier: 397 of 614 s at 25 fps or more. I won't call that jank. The recorder is screenshotting 290 photos in the same run, and a static screen produces no frames. The honest reading is that I can't separate rig load from app load, and a device run is the only valid test.

Things I can see in the code:
- `ApexNavApp.swift:728-732`: location (`BestForNavigation`, no distance filter, background updates allowed), the barometer and 100 Hz CoreMotion start at init and have no stop path outside the thermal guard. That is a drive-grade sensor stack running on an idle map, in a driveway. The 10 Hz JSON bridge to the page runs with it. This is read from code, not measured.
- `index.html` loads 85 deferred script tags (about 2.2 MB of JS) before the map. `lazy.js` moved only the social group out, and its own comment says so.
- Every phone-map flow logs `styleimagemissing` warnings for `gate`, `office`, `swimming_pool` and others, in every flow. The car map silences them (`carmap.js:324`) and the phone doesn't. It's harmless noise, but it's a cheap sign that the phone style asks for sprites it doesn't have.
- `power.js` is well judged. Thermal only at critical (the owner's call), 30 fps cap, hysteresis on battery. But its only visible result is a 30 fps cap, and nobody can tell whether it ever fires.

## 2. Proposals

### NA-1: Measure it. Signposts and MetricKit, and a timing block in the review log
- **Why:** every other performance claim in this repo is untested, and recording 7 can't show launch, hitches or heat. Evidence: no timing event in any of nine `app-log.txt` files; the flows' first log line lands between 0:44 and 4:36 into the video, and that spread is rig and sign-in time, not app time.
- **Build:**
  - Add `OSSignposter` intervals in the shell: process start to `didFinish`, to the page's first `apex.live` ack, to map idle (first tile rendered), and to first location fix. Add one for each tab switch and for sheet open.
  - Log them as `APEX-REVIEW perf <name> <ms>` so `app-log.txt` carries them.
  - Subscribe to MetricKit (`MXMetricManager`, or the iOS 27 `MetricManager`) for hangs, launch, hitches and energy. Write the daily payload summary to the review log and the Feedback diagnostics.
  - Have the rig record `thermalState` and `batteryLevel` at the start and end of each flow.
- **Cost:** M.
- **Done looks like:** every review pack ends with a table: cold launch to map idle, hitch rate during the drive, and battery and thermal start/end. It is labelled simulator or device.

### NA-2: Stop running the drive sensor stack when you're not driving
- **Why:** an idle map shouldn't hold a 100 Hz IMU, the barometer, best-for-navigation GPS and a 10 Hz bridge, with a background-location indicator. It costs battery and heat for the Sunday driver in the driveway, and the battery budget claims the cost per hour of a drive. Evidence: `ApexNavApp.swift:728-732` and `1465-1476`; there is no stop path except the thermal pause.
- **Build:**
  - Idle: `kCLLocationAccuracyHundredMeters` or `startMonitoringSignificantLocationChanges`, no IMU, no barometer, bridge at 1 Hz or on change.
  - Promote to the full stack at drive start, at a car connection, or when speed is over about 8 m/s (`AT_SPEED_MPS`).
  - Demote after N minutes stopped.
  - Keep `showsBackgroundLocationIndicator` only while recording.
  - Keep the thermal guard.
- **Cost:** M.
- **Done looks like:** the review pack's idle flows show a measured (NA-1) drop in energy, and a drive's first fix after Start isn't slower than before.

### NA-3: A smaller launch: stage the 85 scripts
- **Why:** WKWebView parses and runs about 2.2 MB of JS before the first interaction. F-03's `lazy.js` is the right idea, applied to one group. Evidence: `web/index.html` carries 85 deferred scripts; `lazy.js` lists 17.
- **Build:**
  - Use NA-1's timings to find the heavy ones.
  - Split the launch path into the map, deck and drive loop only.
  - Add groups for the Log, Garage, Plan and replay, loaded on first tap or at map idle.
  - Optionally cache the compiled scripts with a WKWebView process pool or a precompiled bundle.
  - Keep any test that asserts script order.
- **Cost:** L.
- **Done looks like:** cold launch to map idle is down by a measured amount, on a device and in the table from NA-1.

### NA-4: Clean the map style warnings and the dead layers
- **Why:** `styleimagemissing` fires in every flow for `gate`, `sports_centre`, `office`, `swimming_pool`, `lift_gate`, `atm`, `athletics`, `running`. The MapLibre runtime does work for each miss, and the console noise hides real warnings such as "Map cannot fit within canvas" (`planning/app-log.txt`, 22:47:33), which is a real layout bug on the route preview.
- **Build:**
  - Add the missing sprites or drop those POI layers in the style.
  - Register a no-op `styleimagemissing` handler on the phone map like the car's.
  - Fix the fit-bounds padding in the preview when the sheet covers more than the canvas.
- **Cost:** S.
- **Done looks like:** an app-log with no sprite warnings and no fit warning in the planning flow.

## 3. Did round 1 land?
Not measurable by me. Round 1 built features, not performance, and the pack can't show their cost. The guided drive completing 20 minutes without a stall or crash is the one real signal: the car video has no frame gap over 37 s (a static screen makes gaps), and the drive reached End and the Log.

## 4. What I'd protect
- `power.js`'s rules (thermal only at critical, hysteresis on battery) and F-05's "a drive draws less", cap at 2x pixels, hide contours at speed.
- The drive journal and the stall detector (`stallFrames`, `flushBacklog`): a suspended web view loses no fixes. That is the right architecture for a web view in a car.
