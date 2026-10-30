# Review recording

Every real-world flow of the iPhone app, recorded on GitHub's Macs for a design review (the owner, 2026-10-30: "fully
screencap the whole app in use … for a more in depth Fable review including every real world user flow"). **On demand
only:** Actions → *App review recording* → Run workflow. About 20–25 minutes; eight Mac jobs (GitHub bills Mac minutes at
10× on a private repo, so one run is roughly 1,500 billed minutes).

## What it produces

The `review-pack` artifact, one folder per flow:

| File | What |
|---|---|
| `phone/NN-step.png`, `car/NN-step.png` | a photo of each step, on the phone and (drives) on the car's screen |
| `sheet-phone.png`, `sheet-car.png` | contact sheets of those, labelled |
| `phone.mp4`, `car.mp4` | the whole flow as video (no sound) |
| `transcript.txt` | every line the co-driver said, with its time |
| `app-log.txt` | the app's own log |
| `INDEX.md` (top level) | the flows, their steps and the first lines said |

## The flows (UITests/ReviewFlows.swift)

1. **first-run**: opening cover, onboarding, the idle map, Layers.
2. **tabs**: Map, Log (a drive's page, its replay), Crew, Garage, scrolled.
3. **planning**: Where to?, suggestions, a route card, Save, Find a loop.
4. **guided-drive**: the replayed road as a GPX route, on the phone and in CarPlay; a hazard report; the Live Activity from
   the home screen; the phone on its side; the end card and the drive in the Log.
5. **free-drive**: a drive with no route (the road ahead), phone and CarPlay.
6. **tapedeck-night** and 7. **billet**: a guided drive in each theme.
8. **signed-in**: Crew, Friends and the account (needs the review account below; skipped without it).

## How it gets close to the real world

- **A real drive, not straight lines.** The simulator has no motion sensors and simctl's GPS only runs straight lines, so
  debug builds can replay `web/data/dry_ridge.js` (a real drive: iPhone 15 Pro, 24 Oct 2026, 57 km near Dry Ridge Rd,
  Cincinnati) through the shell's own GPS and motion handlers (`ApexReplay` in ApexNavApp.swift, `APEX_REPLAY=dry_ridge`).
  The phone's 100 Hz motion is rebuilt from what the drive measured (its forces and yaw turned back into the phone frame by
  its mount, gravity tilted by the measured camber and grade, vibration at the measured roughness), so the app's pipeline
  has to find the mount, banking and roughness again as in a car. It sits parked until a drive starts.
- **The same road as the route.** `APEX_REVIEW_ROUTE=1` hands the page that road as a GPX through the real import path, so
  guided drives follow the road being driven (notes, directions, CarPlay guidance).
- **Sound as text.** Simulator video has no sound and audio capture on GitHub's Macs is unproven, so the page logs each
  line it says (`APEX-SAID`, review mode only) and the workflow turns that into the transcript.
- **The car's screen.** Opened from the Simulator's I/O menu; Vetta is opened on it by XCUITest through the CarPlay home
  screen's accessibility (`com.apple.CarPlayApp`), the way tadasant/zimmer#1412 does; clicks from the Mac never reached it.

All of the above is inside `#if DEBUG` (tests/test_review_recording.py checks it): an App Store build has none of it. The
replayed drive is never sent as measured road data: the review account keeps Share road feel off (CLAUDE.md rule 3).

## The review account (signed-in flow)

Not set up yet: it needs a repository secret only the owner can add (docs/OWNER_TODO.md). Until then the signed-in flow
skips itself and the rest run.

## Not covered

The lock screen itself (XCUITest can't press the lock button; the Live Activity is checked from the home screen's
Dynamic Island), the motion of a real phone in a real car (the replay is a real drive, but rebuilt motion), sound, a
second person in a convoy (planned with the review account), and anything that needs a real car.
