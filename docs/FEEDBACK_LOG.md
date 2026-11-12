# TestFlight feedback handled (the daily run; tools/crash_logs.py, .github/workflows/crash-logs.yml)

Each item by its "shared" time (UTC), and what handled it. Only the owner's screenshot notes are acted on; crash reports
from any tester are fixed when they are an app bug.

| Shared | Kind | Note | Handled by |
|---|---|---|---|
| 2026-10-31T00:20:36Z | owner note | make video doesn't work | daily run 2026-10-31 (feedback builder C) |
| 2026-10-31T00:21:35Z | owner note | which road → which route was better, with previews | daily run 2026-10-31 (C) |
| 2026-10-31T00:24:31Z | owner note | stage on the map, any whole road as a stage | daily run 2026-10-31 (C) |
| 2026-10-31T00:26:40Z | owner note | no image-card share on the crew page | daily run 2026-10-31 (A) |
| 2026-10-31T00:27:19Z | owner note | invites and shares open the real share sheet | daily run 2026-10-31 (A) |
| 2026-10-31T00:30:18Z | owner note | scoreboard: photos, week/month/year/all, total Score | daily run 2026-10-31 (B; migration 0043) |
| 2026-10-31T00:31:01Z | owner note | Crew drives menu → + on Upcoming drives | daily run 2026-10-31 (B) |
| 2026-10-31T00:32:25Z | owner note | menus slide up from the bottom, modal | daily run 2026-10-31 (A) |
| 2026-10-31T00:33:05Z | owner note | text aligned centre-left | daily run 2026-10-31 (A) |
| 2026-10-31T00:40:34Z | crash (owner) | native car map hillshade colour | #271 |
| 2026-10-31T00:41:04Z | crash (owner) | same | #271 |
| 2026-10-31T00:51:14Z | owner note | Where to? field under the Dynamic Island | daily run 2026-10-31 (A) |
| 2026-10-31T00:51:55Z | crash (owner) | same as 00:40 | #271 |
| 2026-10-31T00:51:58Z | crash (owner) | same as 00:40 | #271 |
| 2026-10-31T01:51:29Z | owner note | "this is so bad": a route Preview stacked over everything | daily run 2026-10-31 (A) |
| 2026-11-03 (in chat) | owner, relaying a tester | a deliberate detour: rerouted back, "Rerouting" again and again | #285 (heading on the reroute, said once per detour) |
| 2026-11-03 (in chat) | owner, relaying a tester | music too loud over the voice; a setting? | #285 (While Vetta speaks: Lower / Pause music) |
| 2026-11-03 (in chat) | owner, relaying a tester | "it tweaks when finding a new route" | #285 (seamless route swap, one status, no camera snap) |
| 2026-10-31T00:18:12Z | owner note | need to see map under path (the drive page's route picture) | #286 (the app's map under the path) |
| 2026-10-31T00:18:33Z | owner note | explain what grip circle actually means? | #286 (a line and a tap-to-open explanation) |
| 2026-10-31T00:19:26Z | owner note | how do I slide to align when video doesn't preview? (dashcam overlay) | #286 (live preview with the overlay, step by call) |
| 2026-11-03T17:10:38Z | co-developer note | "Shits in my way when I lead" (convoy card over the road ahead) | #286 (one line behind the car; calls from Report or a tap) |
| 2026-11-03T22:00:11Z | owner note | "I want to see the rest of the map here not just my path" (drive page) | #290 (map zooms and pans; the map itself was build lag) |
| 2026-11-03T22:59:22Z | owner note | "i should be able to swipe this submenu out of the way" (Crash check sheet) | #290 (sheets swipe down to close) |
| 2026-11-05T03:21:09Z | owner note | "takes up so much screen" (the idle map's deck: Where to?, Best roads nearby, three rows) | claude/feedback-1105 (the suggestion and one road; a swipe down on the bar folds it to the bar alone, kept) |
| 2026-11-05T03:21:38Z | owner note | "glitched animation when opening this menu" (Ways to go) | claude/feedback-1105 (the sheet was scrolled for its focused key mid-slide; never now, keyboard.js) |
| 2026-11-05T03:22:31Z | owner note | "bad text spacing" (a stage's Board and Runs in the Log) | claude/feedback-1105 (a run is a line with its components under it; the empty board a sentence; no "@null") |
| 2026-11-05T03:24:54Z | owner note | "unnecessary note and button, tapping your own pfp should let you change/remove it" (Garage, You) | claude/feedback-1105 (the photo is the key: pick, or Choose a new photo / Remove photo / Cancel) |
| 2026-11-05T03:25:36Z | owner note | "bad when typing new crew info" (Find or start a crew behind the keyboard) | claude/feedback-1105 (sheets stand on the keyboard, the field in view; the form in the order it is filled) |
| 2026-11-05T03:26:33Z | owner note | "a dashboard like the facebook groups you're in, with a feed and the option to pin crews?" (Crews) | claude/feedback-1105 (in 2+ crews: the dashboard, pins, Latest from your crews; GET /api/crews/feed) |
| 2026-11-11T21:14:22Z | owner note | "tapping a corner or moment here should orient the view above to show that corner zoomed in on the map" (a drive's page) | claude/project-thread-0wt1zm (a row glides the map in on that corner or moment; All or Recenter shows the whole drive) |
| 2026-11-12T01:29:22Z | owner note | "bird watching shelter blocks half the route" (a named viewpoint's stamp on a loop preview) | claude/project-thread-0wt1zm (a VIEW stamp like CAFÉ and FUEL; the name on a tap, or on the stamp at zoom 15+) |
| 2026-11-12T02:30:37Z | owner note | "why pace and sight different?" (replay HUD: PACE 83, Sight 65) | claude/project-thread-0wt1zm (the gauge's PACE is the lower of the two) |
| 2026-11-12T02:33:04Z | owner note | "generated time attack loops is literally like an hour away from me and goes only through a neighborhood" | handed to the social thread (owner of the weekly loop picker) |
| 2026-11-12T02:35:15Z | owner note | "meeting points switch broken" (crew page) | claude/project-thread-0wt1zm (no Home pinned: the square you are in) |
| 2026-11-12T02:45:11Z | owner note | "cluttered interface ai slop" (Where to? chips) | handed to the UI thread |
| 2026-11-12T02:45:27Z | owner note | "cryptic hidden cluttered ai slop" (the map deck) | handed to the UI thread |
| 2026-11-12T02:46:28Z | owner note | "ai slop walls of text everywhere" (Ways to go) | handed to the UI thread |
| 2026-11-12T02:47:11Z | owner note | "text walls everywhere" (Your driving, Practicing) | handed to the UI thread |
| 2026-11-12T02:47:34Z | owner note | "unreadable unintuitive slop" (Your driving) | handed to the UI thread |
| 2026-11-12T02:47:54Z | owner note | "unreadable unintuitive slop" (the Log list) | handed to the UI thread |
| 2026-11-12T02:48:13Z | owner note | "slop test looks like shit" (Crews) | handed to the UI thread |
| 2026-11-12T02:48:34Z | owner note | "slop slop sop slop slop sloooop" (Garage settings) | handed to the UI thread |
