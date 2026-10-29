# App review (2026-10-28)

A walk through every screen, menu and spoken line, against docs/BRAND.md, docs/APP_REVIEW.md and "best in class". How:

- **Browser tour with sound** (`tools/app_tour.js`): Playwright drives the real cockpit at iPhone size (390×844) through
  onboarding, the map and its menus, search → route card → options → Preview → a drive on simulated GPS → hazard report →
  drive end, the demo replay, loops, Explore, Log, Stages, Crew (signed out and as a member) and Settings. Every clip the
  co-driver plays is captured from WebAudio and every spoken line is logged and burned in as a caption, so the review hears
  and reads what a driver would. `OUT=dir node tools/app_tour.js [scene ...]`.
- **iPhone simulator** (`.github/workflows/app-tour.yml`, run by hand on GitHub's Mac runners): the real app with the
  on-screen keyboard. `AppTourTests.testKeyboard` taps every text field on every tab, screenshots it with the keyboard up and
  fails if the field ends up under the keyboard; `testTour` is recorded as video while simctl drives a GPS route.
- **The owner's own phone** (screenshots, 2026-10-28): the keyboard pass below.

Severity: **S1** wrong or unsafe (App Review risk, a lie on screen), **S2** looks broken or confusing, **S3** polish.

## Found and fixed

| # | where | what | sev | fix |
|---|---|---|---|---|
| 1 | binnacle, Road cell | Read as the road's own speed (125 on a highway), which looks like a target (App Review 1.4.1) | S1 | Owner, 2026-10-29: same number, named for what it is: **Sight**, the speed you could stop from within what you can see (and no faster than the corner allows), uncapped; signal colour when you're above it. The App Review notes should describe it as a braking range |
| 2 | demo replay | Drove up to 10% over the limit | S1 | The replay keeps to the limit |
| 3 | keyboard, every text field (owner's phone) | The tab bar floated over the plan sheet or showed through behind the keyboard; the sheet's own search field could be panned out of sight; a focused field got a second, offset ring in the accent colour | S2 | `web/keyboard.js`: while a field has the keyboard the tab bar hides and the page fits above the keyboard; one ink border on the focused field. Checked on the simulator by `testKeyboard` |
| 4 | route card, Options | Offered a route both slower and less fun than another ("Fun 64 · 102 min" next to "Fun 99 · 77 min") | S2 | Dominated options are dropped (`FunRoute.distinctOptions`) |
| 5 | route card | "Cameras --" when the camera check hadn't run; "no fuel for 50 mi (mi 0–50)" | S2 | Cameras only once known ("2 plate cameras" / "No known plate cameras"); fuel in words ("No fuel on the way", "for the first 40 mi", "from mi 9 to 68") |
| 6 | route card | The route's name twice (sheet bar and card); "Climbs 11,056 ft · 858 ft to 5,387 ft · see the hills in Preview"; "Flowing sweepers 7.6 mi at 13.0 mi · Flowing sweepers 6.0 mi at 21.3 mi · …" | S3 | Name once; "Climbs 11,056 ft in all · highest 5,387 ft"; "Flowing sweepers at 13.0, 21.3 and 29.6 mi" |
| 7 | plan sheet, Loop | "15 · 30 · 45 mi · 1 h · 2 h": the first two had no unit next to "Explore 15 min" | S3 | Every chip has its unit; Loop is its own row; "Tap the map" and "Open GPX" line up |
| 8 | Crew | "@nate undefined points" if the points call came back without a total | S2 | Points only when known, rounded |
| 9 | road book strip | Long calls cut off ("SQUARE LEFT OFF-…", "LEFT 4 OPENS…") | S2 | Long calls step down a size and read whole |
| 10 | binnacle, Limit cell | Unknown limit drawn as a solid black sign with a dash | S3 | A sign only when there is a limit; unknown is a quiet outlined cell |
| 11 | replay toast | "Camera map offline. No pins doesn't mean no cameras." | S3 | "Camera map is offline, so cameras may be missing from the map." |
| 12 | onboarding, sign-in notes | Terms and Privacy in browser blue | S3 | Links are ink, underlined, like the rest |
| 13 | page change at night | Log → Crew flashed the day colours before the night ones | S3 | `themes.js` puts the last look back from `<head>` |
| 14 | exports | Downloaded files named `apexnav-…` | S3 | `vetta-my-data.json`, `vetta-drives-<date>.gpx`, `vetta-account.json` |
| 15 | drive status | "Rec 0.11 mi · 77 min left · 8:24 PM" broke inside "8:24 / PM" and ran to four lines beside Report and End drive | S2 | Parts stay whole; lines break between them |
| 16 | road book strip, next boxes | "LEFT 4 P…" in the smaller boxes | S3 | Long calls there wrap at a smaller size |
| 17 | hazard sheet | Titled "Report ahead of others" | S3 | "Report a hazard" · "Drivers coming this way get a warning." |
| 18 | CarPlay bridge (new, caught in review before merge) | Turn-now directions and crests share the urgent speech lane with hazards, so the car would have shown every turn as a hazard alert | S1 | Only member, reported and convoy hazards alert the car (`alert: true`), tested |
| 19 | keyboard, in the app (simulator run 1) | The web-only fix (#3) didn't work in the app: WKWebView still panned the Where to? field off the top and the tab bar stayed above the keyboard; the check only looked under the keyboard | S1 | The shell undoes the pan and tells the page how much the keyboard covers (`keyboardMoved`, `ApexKeyboard.native`); `testKeyboard` now also fails on a field off the top or a tab bar while typing, and reaches every tab (the Log page's tabs are links) |
| 20 | app launch (simulator) | A plain white launch screen flashed before the dark cockpit | S2 | Launch screen in the night panel colour (`LaunchBackground`) |
| 21 | Log at night (simulator) | The map was in night colours, the Log page in day colours: it read a saved toggle that auto night doesn't keep | S2 | The Log page takes the night the map last showed (`ApexThemes.last`) |
| 22 | every page load (owner) | Theme and map flashes while a page builds | S2 | An opening cover in the theme's colour with the mark, lifted once the map is styled and drawn (or the Log has rendered), never more than 2.5 s (`web/boot.js`) |

## Audio

Lines heard in the replay and the simulated drive (the captions in the tour video):

- "Right 1 plus off-camber, care and Bump, 120" · "Left 4 opens over crest, care into Crest, 150" · "Dip, 100" ·
  "Crest, 300" · "Square left off-camber, caution".
- Calls are short, in rally order (direction, severity, modifier, distance), and the device voice and the voice bank agree.
- Prompts duck the music and wait for it to dip (PR #226); nothing spoke over another line in the tour.

## Still open

- After a drive ends at night the next map can open in day tiles for a moment while auto night waits for a position fix.

- The simulator recording and keyboard screenshots (`app-tour` artifact) after this merges: `testKeyboard` failures, if any,
  are fixed in the next PR.
- Loops and Explore need a location in the tour (the browser tour starts them before granting one); planning by search
  and the simulated drive cover the same routing.
