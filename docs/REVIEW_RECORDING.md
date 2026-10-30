# Review recording

Every real-world flow of the iPhone app, recorded on GitHub's Macs for a design review (the owner, 2026-10-30: "fully
screencap the whole app in use … for a more in depth Fable review including every real world user flow"). **On demand
only:** Actions → *App review recording* → Run workflow. About 35–40 minutes (guided-drive is the longest: it drives
Dry Ridge Rd's corners end to end); eight Mac jobs in parallel (GitHub bills Mac minutes at 10× on a private repo, so one
run is roughly 2,000 billed minutes).

**The Fable review itself waits for the owner** (2026-10-30: "ensure not to run fable until i say because i want to fine
tune the fable prompt with you"). Recording the pack is fine; handing it to Fable is not, until the owner and Claude have
agreed the prompt and the owner says go. Review 4's prompts (docs/design/REVIEW4_PROMPT.md) were approved on 2026-10-30.

## What it produces

The `review-pack` artifact, one folder per flow:

| File | What |
|---|---|
| `phone/NN-step.png`, `car/NN-step.png` | a photo of each step, on the phone and (drives) on the car's screen; through the corners one every 3 s, and one a second after the car's guidance changes (`car-guide`); photos taken with the phone on its side are turned upright |
| `sheet-phone.png`, `sheet-car.png` | contact sheets of those, labelled |
| `phone.mp4`, `car.mp4` | the whole flow as video (no sound) |
| `transcript.txt` | every line the co-driver said, with its time and the second of `phone.mp4` it falls on (`03:47:09  @ 02:31  Tight right`) |
| `app-log.txt` | the app's own log |
| `INDEX.md` (top level) | the flows, their steps, each video's start time (wall clock, the transcript's clock) and the first lines said |

## The flows (UITests/ReviewFlows.swift)

1. **first-run**: the opening photographed before anything is touched (the welcome), its Start, the location permission
   sheet (this flow alone starts without location granted, as a new phone does), the idle map, Layers.
2. **tabs**: a two-minute drive on the corners first, so the Log has something to show; then the drive's page and its
   Replay, the Log, Crew, Garage, scrolled; and Roadbook at night.
3. **planning**: Where to?, suggestions, the place row tapped (not the search field) and the route waited for, the route
   card, opened and dragged up, Save, the plan sheet's More, Find a loop.
4. **guided-drive**: from a mile before the corners, the replayed road as a GPX route, on the phone and in CarPlay; a
   hazard report (the car a second after); the Live Activity from the home screen, and expanded by a long press on the
   island; the phone on its side; Dry Ridge Rd's corners to the last; the end card and the drive in the Log.
5. **free-drive**: a drive with no route (the road ahead) from the drive's real start, so the interstate join is seen;
   started with the car's **Drive** bar button and ended with its **End** when the car has them (otherwise from the phone).
6. **tapedeck-night** and 7. **billet**: the theme switched by its card's **Use** key and checked, then a guided drive into
   the corners in that theme, and its Replay in the Log.
8. **signed-in**: the member's Crew page (the flow fails if Crew still shows the sign-in page), Friends and the account
   (needs the review account below; skipped without it).

## How it gets close to the real world

- **A real drive, not straight lines.** The simulator has no motion sensors and simctl's GPS only runs straight lines, so
  debug builds can replay `web/data/dry_ridge.js` (a real drive: iPhone 15 Pro, 24 Oct 2026, 57 km near Dry Ridge Rd,
  Cincinnati) through the shell's own GPS and motion handlers (`ApexReplay` in ApexNavApp.swift, `APEX_REPLAY=dry_ridge`).
  The phone's 100 Hz motion is rebuilt from what the drive measured (its forces and yaw turned back into the phone frame by
  its mount, gravity tilted by the measured camber and grade, vibration at the measured roughness), so the app's pipeline
  has to find the mount, banking and roughness again as in a car. It sits parked until a drive starts.
- **Where the corners are.** The drive's first 21 km are Colerain Avenue and I-275; its corners run from the exit ramp at
  21.4 km to 34.1 km on Dry Ridge Rd (found from the drive's own corner events and turning). `APEX_REPLAY_FROM=19.8` (km)
  parks the replay a mile before the first of them; the guided, Tapedeck and Billet drives start there (tabs a little
  further on), free-drive at the real start.
- **The same road as the route.** `APEX_REVIEW_ROUTE=1` hands the page that road as a GPX through the real import path, so
  guided drives follow the road being driven (notes, directions, CarPlay guidance). With a start offset the GPX starts
  where the replay does, as a route planned from there would, and runs to the drive's end.
- **Video time.** The app hides the status bar in a drive, so the workflow writes the wall-clock second each video
  started (`phone-start.txt`, `car-start.txt`, when simctl reports it recording) and the pack puts the video second beside
  every transcript line.
- **Sound as text.** Simulator video has no sound and audio capture on GitHub's Macs is unproven, so the page logs each
  line it says (`APEX-SAID`, review mode only) and the workflow turns that into the transcript.
- **The car's screen.** Opened from the Simulator's I/O menu; Vetta is opened on it by XCUITest through the CarPlay home
  screen's accessibility (`com.apple.CarPlayApp`), the way tadasant/zimmer#1412 does; clicks from the Mac never reached it.

All of the above is inside `#if DEBUG` (tests/test_review_recording.py checks it): an App Store build has none of it. The
replayed drive is never sent as measured road data: the review account keeps Share road feel off (CLAUDE.md rule 3).

## The review account (signed-in flow)

`@vetta_review` ("Vetta Review", created 2026-10-30 at the owner's request): a member with Share road feel off, and no
Google login (its `google_sub` is `review:vetta-recording`, which no Google sign-in can match), so the only way in is its
one session token, good for a year. The token is never in the repository: it is the `REVIEW_SESSION` repository secret
(the token alone, one line), passed to the test as `APEX_REVIEW_SESSION`. The shell stores it as the signed-in session at
launch, before the page loads, so the page's first `/api/me` is the member's; it then tells the page "signed in" until
the page answers (REVIEW4 U-66: the first recording announced it once at the first page load and stayed signed out). If
the simulator's Keychain refuses it, the shell keeps it in memory for the run (debug builds only). The
owner added the secret on 2026-10-30; without it the signed-in flow skips itself and the rest run.

To revoke it: `DELETE FROM sessions WHERE user_id = '7b39562f-72d8-4f6e-80c8-382820afb133'` on `apexnav-db`. A new token is
a new session row (`id_hash` = sha256 hex of the token) and a new secret value.

## Not covered

The lock screen itself (XCUITest can't press the lock button; the Live Activity is checked from the home screen's
Dynamic Island), the motion of a real phone in a real car (the replay is a real drive, but rebuilt motion), sound, a
second person in a convoy (planned with the review account), and anything that needs a real car.
