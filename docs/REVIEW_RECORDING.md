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
| `app-log.txt` | the app's own lines for the whole flow: the shell's `APEX-REVIEW` events (the replay parked, driving, standing still; a write held back), `APEX-SAID`, and the page's console (`APEX-CONSOLE`, review mode only); no system noise |
| `INDEX.md` (top level) | the flows, their steps, each video's start time (wall clock, the transcript's clock), a warning on any video without its index (moov), the first lines said and the app's review events with their video second |

## The flows (UITests/ReviewFlows.swift)

1. **first-run**: the opening photographed once the welcome is on screen (its Start key, not a timer), then the welcome
   again as its strip moves on, its Start, the location permission sheet (this flow alone starts without location
   granted, as a new phone does), the idle map, Layers.
2. **tabs**: a two-minute drive on the corners first, so the Log has something to show; then the drive's page and its
   Replay, the replay closed (the flow checks the tab bar is back), the Log, People (Friends, then Crews), Garage, scrolled; and Roadbook at night.
3. **planning**: Where to?, suggestions, the place row tapped (not the search field) and the route waited for, the route
   card (it opens by itself), scrolled, closed to its bar, then dragged open by the bar (the flow checks it opened), Save,
   the plan sheet's More, Find a loop.
4. **guided-drive**: from a mile before the corners, the replayed road as a GPX route, on the phone and in CarPlay; a
   hazard report at 5 min (the car a second after; it stays on the phone, see below); the Live Activity from the home
   screen, and expanded by a long press on the island, then the phone on its side, from 13.4 min into the drive, where the
   R5- at 31.1 km and the run of corners after it put a note up; Dry Ridge Rd's corners to the last; the end card and the
   drive in the Log. Its steps are placed by the drive's own clock (`driveTo`), so they land on the same road every run.
5. **free-drive**: a drive with no route (the road ahead) from the drive's real start, so the interstate join is seen;
   started with the car's **Drive** bar button and ended with its **End** when the car has them (otherwise from the phone).
6. **tapedeck-night** and 7. **billet**: the theme switched by its card's **Use** key and checked, then a guided drive into
   the corners in that theme, and its Replay in the Log. Billet's drive stands still for 8 s in the R3- at 25.3 km
   (`APEX_REPLAY_HOLD=25.31:8`, about 5 min in; `app-log.txt` says when), so the strip's passed-note rule (U-86: a corner
   waited in for 3 s at 0 ft drops out and the strip moves on) is on camera.
8. **signed-in**: People: Friends (the flow fails if People still shows the sign-in page), its Invite sheet, then Crews, and the account
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

- **A standstill.** `APEX_REPLAY_HOLD=<km>:<s>` stops the replay for `s` seconds (at most 120) when it reaches `km`, once
  per drive, as a car waits in a queue; one flow (billet) uses it.
- **Videos that open.** simctl writes a video's index (the moov atom) after it is stopped; the workflow sends SIGINT and
  then waits for each recording to exit (up to two minutes) before uploading. The second recording's 20-minute car.mp4
  was cut off after 4 s and would not open; the pack now says so in INDEX.md if it ever happens again.

All of the above is inside `#if DEBUG` (tests/test_review_recording.py checks it): an App Store build has none of it. The
replayed drive is never sent as measured road data: the review account keeps Share road feel off (CLAUDE.md rule 3).

## The recording writes nothing (U-94)

The flows sign in as the review account on the production Worker, so anything the recording posted reached real drivers:
the second recording's Gravel report on New Biddinger Road was heard in the later flows as any member's would be, and by
everyone else on that road (Claude deleted the row). Now nothing the recording does is written, in three places:

- **The page** (`window.APEX_REVIEW`, set by the debug shell only): a hazard report is the member's sheet, its Undo key and
  the pin on the phone and the car, answered on the phone as the Worker would answer it (`reviewHazard` in
  web/index.html) and kept in a local list that a reload of the server's hazards keeps; it never goes to the server or
  the outbox, and the outbox never flushes. A "still there?" answer stays on the phone. Every other write through
  `ApexSync.apiFetch` (web/sync.js) answers 204 without leaving the page, the Log's frame included; app-health counts and
  error reports are not sent (errors go to the app-log instead).
- **The shell** (`ApexApiBridge`, debug builds with APEX_REVIEW=1): any request but GET or HEAD is answered 204 and logged
  (`APEX-REVIEW held POST /api/…`), so a write the page missed still goes nowhere.
- **The Worker** (backend/src/hazards.ts `REVIEW_USER_ID`): the review account's hazard reports and votes are answered as
  taken (201 / 200, a `review_` id) and never stored, never confirm another report and never count as a vote.

What was checked, each against what the flows can reach: hazard reports and votes (page, shell, Worker); road-feel
segments (`/api/contribute`, off for the account and held); Stages and scores (`/api/segments`, `/api/board`, posted by the
Log's sync; held); kudos; friends-on-the-map presence (`/api/presence`, sent every 30 s while sharing; held); Crew reports
and blocks (`/api/reports`, `/api/blocks`); crew chat, events, RSVPs and pages; feedback; photos; garage; ETA shares;
convoy (its socket opens only after a POST that starts or joins one, which is held, and no flow starts one); app-health and error counts
(anonymous, raw `fetch`; skipped). Drives are never synced to the server (they stay on the phone).
Reads (People: the member's friends and crew page, hazards near the road) still go, so the pages look as a member's do.

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
