# VETTA — BRAND & UI DIRECTION

Status: decided (owner asked for decisions, not options). Supersedes the visual parts of
PHILOSOPHY.md §1 where they conflict. Engineers: section 7 is the work list.

Evidence base: the 8 phone captures (390×844) of the current build (`01_cockpit_map` …
`08_analysis_compare`), earlier captures of the Roadbook and Telemetry themes and of the
Account panel (an older build, before the gauge cluster was hidden on menus), `web/themes.js`, the CSS
and strings in `web/index.html`, `web/analysis.html`, `web/instruments.js` and `web/drive_view.js`.
**Not seen:** real map tiles in the 8 captures (blocked), Drive mode on a real phone, the
signed-out and invite screens of Account, night mode of the current build. Crews have no UI to see.

---

## 0. Critique: why it reads as AI-made and why it confuses

1. **Copy explains how it works instead of telling you what to do.** The Route sheet
   (`02_route`) carries two paragraphs longer than its controls: "Loops are stitched from the
   best roads nearby: every road around you is scored from map geometry (corners per km, few
   junctions), the best stretches are chained…" and a 4-sentence Highlights paragraph. Setup
   (`04_setup`) explains "Kokoro-82M model (Apache-2.0)… one-time ~90 MB download". History
   has an 80-word Driver Score paragraph. Implementation names (Overpass, Valhalla, DeFlock,
   Kokoro) appear in toasts. This is the single biggest "written by a model" tell.
2. **Everything is uppercase, letter-spaced and dim, so nothing has hierarchy.** Tab labels are
   9 px/0.16em, readout labels 8 px (`.ro span`, `.dna-cell span`, `.odo-meta`), section heads
   10 px/0.18em, buttons 11–12 px/0.12em, all caps. "Dark panel + one orange accent + tracked
   caps" is the default look of generated dashboards. At arm's length in a car, 8 px is unreadable.
3. **Jargon from the design docs leaked into the UI.** STAGE, LPR, DNA switches; PACE / SIGHT /
   LIMIT chips; TECH / FLOW / SURF / CLEAR; "TOWN"; "BANK +0.0°"; "Profiled drives";
   "Octane: n points"; "PULL" slider; "LIVE READY"; "DEVICE"; theme cards tagged
   "AB", "A", "B", "C" (internal letters from session notes); "SIM · NOT DRIVEN";
   "RUN", "1X". A first-time user can decode none of the 5 binnacle switches.
4. **The same thing appears in three places.** DRIVES (`03_drives`) lists two drives and a
   button to "OPEN DRIVE ANALYSIS →"; ANALYSIS → HISTORY (`06`) lists the same drives again;
   the analysis page then stacks its own tab row (DRIVE/HISTORY/SEGMENTS/COMPARE), a
   "← Cockpit" link and the bottom tab bar: three navigation systems on one screen (`05`–`08`).
   Menus have both a CLOSE key and "tap the open tab to close".
5. **The pace-note strip sits on top of every menu.** `02`–`04` all start with "BUMP · MEASURED
   0.44 G · SINGLE PA… 300 FT" while the user is choosing a voice. The note is truncated, and it
   repeats itself: "BUMP" big, "BUMP" again under the next-note tulip. Roadbook prints
   "R1 / RIGHT 1", the same call twice.
6. **No hierarchy in results.** Drive (`05`) gives Driver Score 673 the same tile as Climb
   1942 ft; nothing says out of what or whether it is good. Top speed (74 mph) gets equal billing,
   which contradicts "Score is technique, not speed". Below the map a readout shows
   "0.00 mi · 0:00 · 2 mph · L 0.02 g · accel 0.03 g · --" before you have touched anything.
   Corner numbers on the plan map pile on top of each other (9/7/5/13/15/18/3 in `05`, 10–13 in `08`).
7. **Compare (`08`) shows two "seconds" numbers that disagree.** "+0.11 s corner time B vs A"
   in red and "+914.50 s whole shared road" with a caption saying it is "not a driving verdict".
   If it is not a verdict, do not show it. The "SWAP" button floats between two selects, with the
   A and B letters outside them.
8. **Social is buried.** Friends, invites, sharing, points, road-data sharing, export and delete
   account are one stack at the top of SETUP, above the voice picker, as identical outline
   buttons (`acct.png`: SHARE SCORES, SHARE TIMES, UNFRIEND, each 2 lines tall). The section is
   **hidden entirely** when `/api/me` fails, so in `04_setup` it does not exist. Crews exist in
   the backend (`crews`, `crew_invites`) with no UI. The Segments page tells you to "Sign in
   (Account on the main page)".
9. **Selection states are ambiguous.** In `04_setup` the selected voice GEORGE and the status
   toggle LIVE READY are both solid orange; DYNAMIC is solid orange for "selected". Primary
   actions (GO, SAVE SEGMENT, OPEN DRIVE ANALYSIS) are solid cream. There are two "solid"
   meanings and no rule.
10. **Stock colours and too many fonts.** Telemetry and the analysis `.gain` class use
    `#3FB950`, `#F85149`, `#58A6FF`, which are GitHub's Primer palette verbatim. Four
    Google font families load on every page (Barlow Condensed, IBM Plex Mono, IBM Plex Sans
    Condensed, Inter Tight). Four themes, two of which (Stage, Instrument) share fonts, dials and
    accent and differ only in hex values.
11. **Errors shout and hedge.** "Absence of pins is NOT clearance." "If that member exists, they
    have your request." "Could not share it (maybe one already exists within 40 m, or the daily
    limit is reached)." The busy button adds a shimmer sweep on top of a real progress bar.
12. **Touch targets too small for a car.** `.key` is 28 px tall (RUN, 1X, CLOSE), analysis
    zoom buttons 30 px, selects 34 px. Inline `style="margin-top:6px"` all over the markup means
    spacing differs panel to panel.
13. **No first run.** The app opens onto a blank map under a replay of someone's drive, with a
    camera-data error toast (`01`). There is no "what is this", no prompt to start a drive, and
    permissions are only explained in the status bar after they fail.

---

## 1. Positioning

**Vetta is the co-driver for people who take the long way home: it reads the road ahead
out loud, scores how cleanly you drove it, and keeps a shared road book with your friends.**

- **For:** enthusiasts in their own road cars on public back roads, driving with a small group
  of friends (invite-only, US, under 20 people today). They know what a hairpin and a crest are;
  they do not know what LPR, DNA or an envelope is.
- **The feeling:** a rally co-driver and a road book. Calm, exact, a step ahead. Paper, ink, one
  red pen. The app is quiet until the road gets interesting.
- **Not:** a gamer dashboard (no neon, no XP, no robot voice, no top-speed brag), not a nav app
  (no turn-by-turn to an address as the main job), not a lab tool (no raw g traces up front).
- **Promise to keep:** unknown stays unknown (`--`), nothing is shared until you share it,
  and there are no speed or time leaderboards.

---

## 2. Voice and tone

### Rules
1. **Talk like the co-driver.** Short, present tense, the instruction first. "Paste your invite."
   not "You are signed in. Ask a member for an invite to see friends."
2. **One line of help, maximum, under a control.** If it needs more, the control is wrong. Longer
   explanations go in a collapsed "How Score works" row, not in the flow.
3. **Sentence case for everything** except pace-note calls (`LEFT 4 TIGHTENS`), the LIMIT sign and
   the map mode plate. These are the "printed" voice; all-caps elsewhere is banned.
4. **Numbers first, units small.** "673 /1000", "35.6 mi", "+0.11 s". Unknown is `--`, never 0.
5. **Failures say what happened and what to do, in that order.** No blame, no internals.
   "Camera map offline. No pins doesn't mean no cameras."
6. **No implementation names outside Settings → Sources.** Not in toasts, notes or buttons.
7. **Privacy is said once, plainly, at the moment of sharing.** Not as a subtitle on every page.
8. **US units first** (mph, ft, mi). The app is US-only.
9. **Name things by what the driver sees** (section 3), never by the algorithm.

### Before → after (real strings)
| # | Where | Before | After |
|---|---|---|---|
| 1 | toast, `index.html` | LPR camera data unavailable (Overpass unreachable). Absence of pins is NOT clearance. | Camera map offline. No pins doesn't mean no cameras. |
| 2 | Route note | Loops are stitched from the best roads nearby: every road around you is scored from map geometry (corners per km, few junctions), the best stretches are chained to fit the distance, and the result is checked against a plain loop. Geometry only until driven. | Loops pick the twistiest roads near you. Map only until someone drives them. |
| 3 | Highlights note | When on, loops lean toward roads that pass a highlight you rate 3 stars or more. They can tip the choice between two good roads; they never make a dull road win. Yours stay on this phone until you press SHARE… | Loops lean toward spots you rate 3★ or more. Your spots stay on this phone until you share one. |
| 4 | Voice note | George, Daniel and Emma are rendered with the open Kokoro-82M model (Apache-2.0); pace notes work offline. LIVE also runs the model… | Who reads your notes. Works offline. |
| 5 | pace-note sub | Measured 0.44 g · single pass, unverified | Driven once |
| 6 | quiet strip | Dry Ridge Rd · cruise: hazards and LPR only | Quiet · bumps and cameras only |
| 7 | toast after drive | Saved 35.6 mi. Open ANALYSIS to see it. | Drive saved · 35.6 mi  [View] |
| 8 | Account | You are signed in. Ask a member for an invite to see friends. | Vetta is invite-only. Paste your invite. |
| 9 | Friend request toast | If that member exists, they have your request. | Request sent. @handle sees it if they're a member. |
| 10 | Segments note | Segments are your custom stretches. Every drive that covers one, in the same direction, is ranked on it by Driver Score. Sign in (Account on the main page) to back them up and compare with friends. | Mark a stretch you drive often. Every run gets a score. |
| 11 | History note | Driver Score (0-1000) rates technique, never time or speed: pace = … (80 words) | Score rates how you drive the corners, not how fast. 1000 is a closed-course number. (rest moves into "How Score works") |
| 12 | Compare card | +914.50 s · whole shared road · includes stops and traffic, so not a driving verdict | (deleted) |
| 13 | Highlight share error | Could not share it (maybe one already exists within 40 m, or the daily limit is reached). | Not shared. There's already a spot here, or you've hit today's limit. |
| 14 | Road data toggle note | Optional. Shares anonymous road numbers (banking, roughness, crests), never where you went or how fast. Earns points: 3x for the first… | Share road feel: banking, bumps and surface. Never where you went or how fast. First to map a road earns 3×. |
| 15 | Stage DNA toast | Stage DNA needs a profiled drive; this route is geometry only. | (control removed; route card shows "Road feel after first drive") |
| 16 | Routing error | Routing failed: ${err.message}. Check your connection. | Couldn't build the route. Check signal and try again. |

### Banned in UI copy
Filler and hedging: *simply, just, please, note that, optional.* (as a sentence opener), *maybe,
basically, actually, successfully, thanks,*. Explaining the obvious: *tap the button to…,
here you can…, this screen shows…, below zero: B was ahead* (label the axis instead).
Hype: *unlock, level up, supercharge, seamless, smart, AI, powered by, next-gen, pro*.
Shouting: any all-caps word for emphasis (*NOT*), exclamation marks, emoji.
Internals: *profiled, geometry only, envelope, sector, LPR, ALPR, DNA, Octane, Overpass,
Valhalla, OSRM, Kokoro, Nominatim, verdict, single pass unverified, e.g.*.
Vague errors: *something went wrong, unavailable, oops, invalid* (say what is wrong).

---

## 3. Vocabulary (canonical names)

| Concept | Call it | Replaces | Notes |
|---|---|---|---|
| Vetta Score (0–1000) | **Vetta Score**, **Score** once named | Driver Score, Smoothness score, LATEST DRIVER SCORE | Always shown as `673` with small `/1000`. How it is worked out is not explained in the app or the store copy |
| Score parts | **Pace · Smooth · Brakes · Rhythm** | pace, smoothness, braking, consistency | Rhythm = even commitment corner to corner |
| Crowd reward | **Points** | Octane, OCT, Pioneer bounty | First to map a road and direction ×3, second ×2, then ×1 |
| People you added | **Friends** | — | `@handle` |
| A named group of friends | **Crew** | crews, audiences | One person can be in several crews |
| Ranking of friends on a stage | **Board** | Friends board, leaderboard | Only people who shared with you |
| Per-person sharing | **Share with @x: Scores / Times** | grants, SHARE SCORES, SHARING TIMES | Two switches per friend or crew |
| Recording a real drive | **Drive** | DRIVE, LIVE plate | Red Start drive button, End drive |
| Playing a saved drive | **Replay** | REPLAY | Started from the Log, never a map toggle |
| Playing a planned route | **Preview** | SIM · NOT DRIVEN, geometry only | |
| Calls read aloud | **Notes** (one is a **call**) | pace notes, co-driver notes | |
| Co-driver mode | **Notes: Auto / Full / Quiet** | STAGE switch, "cruise: hazards and LPR only", spirited detection | Auto is the current default behaviour |
| Plate-reading cameras | **Cameras** | LPR, ALPR, Flock, CLEAR | Settings explains: "plate-reading cameras, from OpenStreetMap" |
| Measured road physics | **Road feel** (banking, bumps, surface, crests) | road data, measured, member measurements, ROAD FEEL · MEMBERS | |
| Confidence | **Map only · Driven once · Confirmed** | L0/L1/L2, profiled, geometry only, single pass unverified | |
| Road scores | **Twist · Flow · Surface** + camera count | Stage DNA, TECH/FLOW/SURF/CLEAR, DNA switch | 0–100 bars; cameras as a number or `--` |
| Archetype | **Road type**: Switchbacks, Esses, Technical, Rollercoaster, Sweepers, Fast & open, Town, Connector | archetype, SECTOR, "TOWN" in accent caps | "Flowing sweepers" → Sweepers |
| Braking envelope at the car | **Road** speed | PACE chip + SIGHT chip | `min(corner, sight)`; an eye glyph when sightline is the limit |
| Posted limit | **Limit** | LIMIT | Drawn as the US white sign |
| Envelope use | **Grip used** | envelope use, % of limit | |
| User-made ranked stretch | **Stage** | Segment, SEGMENTS | The rally word; drivers already use it |
| One drive over a stage | **Run** | pass, passes | "Run 3 of 7" |
| Time gained/lost | **Gap** | delta, Time delta B vs A | `+0.11 s` slower, `−0.11 s` faster |
| Scenic stop | **Spot** | Highlight, highlights · scenic stops | |
| Spot pull on loops | **Detour: Off / Little / Some / More** | HIGHLIGHTS ON/OFF + PULL slider | One choice row, not a slider |
| Route search + loops | **Plan** | ROUTE, Route book, Destination · spirited routing | |
| Your drives | **Log** | DRIVES, ANALYSIS, Drive Analysis, Profiled drives | |
| Phone's own TTS | **Phone voice** | DEVICE | |
| Background name rendering | **Speak road names** (switch) | LIVE, LIVE READY/LOADING/FAILED | Status as a sentence: "Downloading voice · 40%" |
| Map motion | **Map motion: Steady / Lean / Whip** | Camera feel, DYNAMIC | |
| Trip odometer | **Trip** | TRIP MI OF 35.6 | `12.4 of 35.6 mi` |
| Later features | **Convoy**, **Ghost**, **Garage** | — | Keep these names when built |

---

## 4. Information architecture (phone)

### Bottom tabs (5, sentence case, 11 px labels, icons 24 px)
| Tab | What lives there |
|---|---|
| **Map** | The cockpit. Idle: map, Start drive. Driving: notes strip, map, binnacle. Replay/Preview: same plus transport. Gear → Settings sheet (voice, notes, map motion, theme, night, units, sources). |
| **Plan** | Search a place, tap the map, Loop 15/30/45 mi, your Spots and Detour. Result = route card with Preview and Drive it. |
| **Log** | Your drives, newest first, each with Score. Tap = drive detail (summary, map, lanes, corners, "This road over time", Compare with…, Replay on map, Share road feel). |
| **Stages** | Your stages, each with your best Score and Board rank; New stage (pick a drive, drag a stretch). Stage detail = runs + Board. Friends' shared stages to adopt. |
| **Crew** | You (`@handle`, points), Invite, Friends with Share switches, Crews, Points board, Share road feel switch, Account (export, delete, sign out). Signed out: what it is for + Sign in with Google + Paste invite. |

Drive vs Replay: **Drive** starts only from the red Start drive button on Map. **Replay** starts
from a drive in Log ("Replay on map"). **Preview** starts from a route card in Plan. The
REPLAY/DRIVE segmented control on the map is deleted; the plate at bottom-left names the mode.

The analysis page becomes Log and Stages: no page title, no "← Cockpit", no inner tab row.
Compare is a sheet inside a drive, not a tab.

### First run (3 screens max, shown once: `localStorage apex.onboarded`)
```
1 ─────────────────────────   2 ─────────────────────────   3 ─────────────────────────
                               Pick your co-driver            Driving with friends?
   [logo.svg, 220 px]
                               ( George  ) ▶                  Vetta is invite-only.
   Your co-driver for the      ( Emma    ) ▶                  Sign in to see their
   long way home.              ( Daniel  ) ▶                  stages and boards.
                               ( Michael ) ▶
   Calls every corner and      ( Phone voice )                [ Sign in with Google ]
   scores how cleanly you                                     [ Paste invite ]
   drove it.                   ▶ plays "Left 4 tightens,
                                 one-fifty"                   Not now
   [ Get started ]
   Watch a replay             [ Next ]                        
```
"Watch a replay" loads Dry Ridge Rd as a Replay and skips to Map. No permissions here.

### Permissions at the moment of need (first tap on Start drive)
```
┌──────────────────────────────────────┐
│ Before your first drive              │
│                                      │
│ Location   to call corners ahead     │
│ Motion     to feel bumps and surface │
│ Screen on  while you drive           │
│                                      │
│ Your drive stays on this phone.      │
│                                      │
│ [        Allow and start        ]    │
│  Not now                             │
└──────────────────────────────────────┘
```
Then the OS prompts, in that order. Denied location → the sheet says "Location is off.
Settings → Safari → Location → Allow" (iOS) and Start drive stays disabled; denied motion →
the drive runs and the status reads "No motion · surface not recorded".

### Wireframes
Map, idle (no route, not driving):
```
┌──────────────────────────────────────┐
│ Quiet · bumps and cameras only       │  notes strip, 1 line
├──────────────────────────────────────┤
│                                 [⚙]  │
│                                      │
│              map (paper)             │
│                  ▲                   │
│                                      │
│ [Follow]                             │
├──────────────────────────────────────┤
│ [         ● Start drive          ]   │  red, 52 px
│  Plan a route · Watch a replay       │  text links
├──────────────────────────────────────┤
│  Map    Plan    Log    Stages  Crew  │
└──────────────────────────────────────┘
```
Map, driving:
```
┌──────────────────────────────────────┐
│ [tulip] LEFT 4 TIGHTENS        150   │  call 22 px caps, distance 28 px
│         into RIGHT 3             ft  │
├──────────────────────────────────────┤
│              map                     │
│ DRIVE ● REC                      [⚙] │  plate
├──────────────────────────────────────┤
│ ( speed dial )  LIMIT  ROAD  ( g-ball│
│                  45     38   & bank )│
│                 12.4 of 35.6 mi      │
│                 Esses                │
│ Notes Auto     Voice on    Cameras   │  3 switches, 11 px labels
│ GPS ● Motion ●           [End drive] │
├──────────────────────────────────────┤
│  Map    Plan    Log    Stages  Crew  │
└──────────────────────────────────────┘
```
Plan:
```
┌──────────────────────────────────────┐
│ Plan                                 │
│ [ Search a town or road        ][Go] │
│ Or tap the map                       │
│ ──────────────────────────────────── │
│ Loop from here                       │
│ [ 15 mi ] [ 30 mi ] [ 45 mi ]        │
│ Loops pick the twistiest roads near  │
│ you. Map only until someone drives.  │
│ ──────────────────────────────────── │
│ Route card (after a build)           │
│ 31.2 mi · 46 corners · Esses         │
│ Twist ▮▮▮▮▯ Flow ▮▮▮▯▯ Surface --    │
│ Cameras 2 · Road feel 18% driven     │
│ [ Drive it ]  [ Preview ]            │
│ ──────────────────────────────────── │
│ Spots                  Detour: Some ▾│
│ ★★★★★ Overlook on Dry Ridge   Share  │
│ [ + Add a spot here ]                │
└──────────────────────────────────────┘
```
Log (list → detail):
```
┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
│ Log                    [Import .csv] │   │ ‹ Log      Dry Ridge Rd   Oct 24     │
│ Score ▁▃▅▆ (only with 3+ drives)     │   │ 673 /1000                            │
│ ──────────────────────────────────── │   │ Pace ▮▮▮▮▯ Smooth ▮▮▮▯ Brakes ▮▮▮▮   │
│ Dry Ridge Rd               673       │   │ Rhythm ▮▮▮▯       How Score works ›  │
│ Oct 24 · 35.6 mi · 30 corners        │   │ 35.6 mi · 46:00 · 30 corners         │
│ ──────────────────────────────────── │   │ ┌ plan map, speed-coloured ───────┐  │
│ Pebble Ridge Ln            631       │   │ └─────────────────────────────────┘  │
│ Oct 24 · 17.7 mi · 13 corners        │   │ lanes: speed / lateral / brake / elev│
│                                      │   │ Corners (vs your best run here)      │
│                                      │   │ 4  L4 tightens   31 mph   −0.20 s    │
│                                      │   │ [Replay on map] [Compare with…]      │
│                                      │   │ [Share road feel]                    │
└──────────────────────────────────────┘   └──────────────────────────────────────┘
```
Stages:
```
┌──────────────────────────────────────┐
│ Stages                  [+ New stage]│
│ Dry Ridge climb        best 702      │
│ 2.4 mi · 6 runs · 2nd on Board       │
│ ──────────────────────────────────── │
│ Shared by @ridge_runner              │
│ Pebble descent              [ Add ]  │
│                                      │
│ (empty) Mark a stretch you drive     │
│ often. Every run gets a score.       │
│ [ New stage ]                        │
└──────────────────────────────────────┘
Stage detail: profile strip, runs table (Run, Date, Score, parts, Time - yours only),
Board (rank, @handle, Score) with "Share your runs with: @a  Crew X" switches inline.
```
Crew:
```
┌──────────────────────────────────────┐
│ @nate                    1,240 points│
│ [ Invite a friend ]                  │
│ ──────────────────────────────────── │
│ Requests                             │
│ @newfriend          [Accept] Decline │
│ ──────────────────────────────────── │
│ Friends                              │
│ @ridge_runner                     ›  │  detail: Share Scores ◻ Times ◻, Unfriend
│ ──────────────────────────────────── │
│ Crews                   [+ New crew] │
│ Sunday Ridge (4)                  ›  │
│ ──────────────────────────────────── │
│ Points board  @a 3,100 · @b 1,900    │
│ Share road feel                 [◼ ] │
│ Banking, bumps and surface. Never    │
│ where you went or how fast.          │
│ ──────────────────────────────────── │
│ Account: Download my data · Sign out │
│ Delete account (red text)            │
└──────────────────────────────────────┘
```
Settings (sheet from the gear on Map): Voice (chips + ▶ sample), Speak road names, Notes
Auto/Full/Quiet, Map motion, Theme (Road book / Instruments), Night (Auto / On / Off), Units, Sources.

---

## 5. Visual identity

### Wordmark and mark
- **Mark:** a road-book tulip for a right-hander: entry dot, road line, exit arrow, and a
  **red apex dot on the inside of the bend**. It is the same drawing language as the pace-note
  tulips the app already draws (`tulipSVG` in `web/instruments.js`), so the logo is a call, not a
  decoration.
- **Wordmark:** `APEX` heavy + `NAV` light, monoline caps drawn as paths (no font dependency),
  flat-cut tops and bottoms. Written "Vetta" in running text.
- Files (all hand-written SVG, ink = `currentColor`, apex = `var(--brand-accent, var(--accent, #C8102E))`):
  - `web/brand/logo.svg`: mark + wordmark, 444×100. First-run screen 1, Crew signed-out state,
    and the web page `<head>` share image. Not inside the cockpit.
  - `web/brand/mark.svg`: square mark, 100×100. Favicon and the About row in Settings. The car
    puck on the map stays the puck; the mark is never used as the car.
  - `web/brand/icon-180.svg`: app icon master, full-bleed dark paper `#1A1814`, cream ink,
    red apex `#E24A4A`; the OS applies corner masks. Rasterise to `apple-touch-icon.png`
    (180×180) and the Xcode asset catalog; iOS will not use SVG there.
  - Theming works only when the SVG is inlined or used via `<svg><use href>`. As an `<img>`,
    `currentColor` falls back to black and the apex to `#C8102E`.
- Clear space: the height of the entry dot × 2 on all sides. Minimum mark size 16 px.
  Never outline, gradient, shadow or rotate it.

### Themes and colour roles
**Default brand look: Road book (`roadbook`), day by default, night automatically after sunset.**
Why: it is the only theme that is not "dark UI with an orange accent"; paper and ink read in
direct sun on a windscreen mount; red ink is what a co-driver marks a road book with; and
the earlier Roadbook capture is the one screen of this app that looks like nothing else.

Keep **two** themes: **Road book** (default) and **Instruments** (today's Stage: dark binnacle
over the topo map, for people who want a dash). **Delete Instrument (B)** (same fonts, dials and
layout as Stage with different hex) and **Telemetry (C)** (GitHub Primer colours, two extra
fonts, a third cluster renderer to maintain). This reverses the session (c) "A/B/C/AB" decision;
it is the cheapest way to make the app look like one product.

Colour roles (both themes use the existing `themes.js` keys; values below are Road book day / night):
| Role | Token | Day | Night | Use |
|---|---|---|---|---|
| Paper | `--panel`, `--stage` | `#EDE4D3` / `#F2EBDD` | `#151310` / `#1A1814` | Backgrounds |
| Ink | `--panel-ink`, `--ink` | `#1C1A17` | `#EDE4D3` | Text, lines, primary buttons |
| Pencil | `--panel-dim` | `#6A6255` | `#8C8373` | Secondary text only, never for values. Every text token holds 4.5:1 on paper (tests/test_themes.py) |
| Rule | `--rule` | `#1C1A17` | `#EDE4D3` | Structure lines only (notes strip, binnacle), 1.5–2 px |
| Hair | new `--hair` | `#CFC4AE` | `#2E2A23` | Row and section dividers, 1 px |
| Red pen | `--accent` | `#C8102E` | `#E65252` | The route, call codes, the apex, Start drive, selected tab. Nothing else. |
| Caution | `--amber` | `#8A5810` | `#D9A24A` | Caution ladder, "brake now" ribbon edge |
| Hazard | (no new token) | ink box, paper text | paper box, ink text | Bump and camera pins and hazard calls. Today they reuse the route red, so a hazard looks like the route |
| Gain | new `--gain` | `#2E6B3F` | `#6FBF7F` | Faster gap, improving trend. Replaces `#3FB950` |
| Loss | `--accent` | | | Slower gap |
Instruments keeps its current Stage values plus `--gain`.

### Type
Two families, both SIL Open Font License 1.1, both already loaded from Google Fonts:
- **Barlow Condensed** (600/700/800): pace-note calls, numbers that matter (speed, Score,
  distance to call, gaps), section titles. Tabular figures (`font-variant-numeric: tabular-nums`).
- **Inter Tight** (400/500/600): everything else: labels, body, buttons, tabs, tables.
- Drop IBM Plex Mono and IBM Plex Sans Condensed from both pages' font link.
- Scale (px): 11 label · 13 secondary · 15 body/button · 18 row title · 22 section title ·
  28 call/distance · 44 Score/speed. Nothing under 11 px anywhere, nothing under 13 px on
  the binnacle while driving. Letter-spacing 0 except caps calls (0.02em) and the LIMIT sign.

### Space, borders, radius
- 4 px grid: 4, 8, 12, 16, 24, 32. Screen gutter 16. Section gap 24. Row padding 12/16.
- **Radius 0** everywhere (printed book), except dots, the puck and the app icon mask.
- **Rules, not boxes.** A section is a title + a 1 px hair rule, like a printed page. Boxes are
  allowed for exactly three things: the pace-note box, the LIMIT sign, and inputs. No
  panel-inside-panel (today `.panel` wraps `.dv-head` which has its own border).
- Road book structure lines (notes strip bottom, binnacle top) stay 2 px ink.

### Buttons
| Level | Look | Height | Use |
|---|---|---|---|
| Record | solid red, paper text | 52 | Start drive only. End drive is solid ink. |
| Primary | solid ink, paper text | 48 | One per screen: Go, Drive it, Save stage, Allow and start |
| Secondary | 1.5 px ink outline | 44 | Preview, Compare with…, Invite |
| Choice | segmented row; selected = ink fill, others outline | 44 | 15/30/45 mi, voices, Steady/Lean/Whip |
| Switch | the existing toggle `.sw` | 44 tap area | On/off settings |
| Text | ink, underlined | 44 tap area | Not now, Watch a replay, Decline |
| Destructive | red text, confirm sheet | 44 | Delete account, Unfriend, Delete stage |
Labels in sentence case, 15 px Inter Tight 600. Accent fill is never a "selected" state.

### Icons
24 px grid, 1.75 px stroke, round caps and joins, no fills except dots (matches today's tab
icons). Tabs: Map (tulip arrow), Plan (route line with pins), Log (stacked lines), Stages
(a stretch of road between two ticks), Crew (two heads). Hazards and calls use
tulip glyphs only. No icon fonts, no emoji, no third-party icon sets.

### Motion
- Sheets: slide 180 ms ease-out (as now). Tabs: no animation.
- Values: no count-up animations; the trip drum may roll.
- Busy: a progress bar and the phase in words ("Finding roads · 2 of 3"); **delete the
  shimmer sweep** (`.ink-btn.busy::before`).
- Map camera motion is a driving aid and keeps its own rules (Steady default for first run).
- `prefers-reduced-motion`: sheets appear instantly, map motion forced to Steady.

### Delete
Instrument and Telemetry themes; IBM Plex fonts; the STAGE, DNA and NIGHT switches; the
SIGHT chip; Twist/Flow/Surface bars on the binnacle; REPLAY/DRIVE map control; DRIVES tab;
"Drive Analysis" header, inner tabs and "← Cockpit"; the whole-road delta card in Compare;
Top speed tile; theme letter tags; CLOSE keys on menus; the Jarvis voice (robot effect is
the gamer register this brand is not); the word Octane; shimmer sweep; the 8–10 px labels.

---

## 6. What stays as it is
Tulip pace notes and the rally call grammar; the speed dial with the LIMIT sign; the g-ball
with bank inclinometer; paper topo map with contours; "unknown is `--`"; sheets that close
by swiping right; the Kokoro voices; the analysis lanes and corner list (only restyled).

---

## 7. Implementation checklist (ordered by impact per effort; max 25)

1. **`web/index.html`, `web/analysis.html`, `web/drive_view.js`: copy pass.** Replace every string in §2 table rows 1–16 verbatim; apply §3 names to every visible label (no logic changes).
2. **`web/index.html` + `web/analysis.html` CSS: sentence case and type floor.** Remove `text-transform: uppercase` and letter-spacing from `.ink-btn`, `.key`, `.tab`, `.tabbar a`, `.sheet h3`, `.sheet header h2`, `.tabs button`, `h1`, `h2`, `.card span`, `.dv-stat span`, `th`; set every font-size below 11 px to 11 px (`.ro span`, `.dna-cell span`, `.odo-meta`, `.dial-label`, `.tab`, `.pn-next small`, `.bar`, `th`); buttons 15 px/600.
3. **`web/index.html`: hide the notes strip while a sheet is open.** Add `#app.sheet-open .notes { display: none; }` next to the existing `#app.sheet-open .binnacle` rule.
4. **`web/themes.js`: Road book is the default.** `get()` falls back to `THEMES.roadbook`; `ORDER = ['roadbook', 'stage']`; labels `'Road book'` and `'Instruments'`; blurbs "Paper and red ink." / "Dark dash over the map."; in `index.html` set `state.theme: 'roadbook'` and delete the `.themes .card b::before` tag rule. Add `gain` to every day/night palette (§5 values).
5. **`web/index.html` + `web/instruments.js`: three switches.** Replace STAGE/VOICE/LPR/DNA/NIGHT with `Notes` (cycles Auto → Full → Quiet; Auto = today's `toggles.stage=false`, Full = `stage=true`, Quiet = never wake on spirited driving), `Voice`, `Cameras` (= `lpr`). Night: Auto (sunset/sunrise from the position via a simple solar formula) / On / Off in Settings. Keep stored prefs compatible (`toggles.stage` → `notesMode`).
6. **`web/instruments.js`: LIMIT + ROAD.** In the dials cluster replace the three `.ro` cells with LIMIT (sign style, unchanged) and ROAD (`min(pace, sight)`, accent number) plus a 12 px eye glyph when `sight < pace`. Remove the `.dna` block from the binnacle; keep the road-type line under the trip (`Esses`, sentence case, ink not accent).
7. **`web/index.html`: Start drive.** Delete `.modesw` from `.plates`; add a full-width red 52 px "Start drive" button above the tab bar when idle, with "Plan a route · Watch a replay" text links under it; show `#transport` only in Replay/Preview; mode plate reads `Replay · Dry Ridge Rd ×` / `Preview` / `Drive ● Rec`.
8. **`web/index.html`: permission sheet.** On the first Start drive tap (flag `apex.permsExplained`), show the §4 sheet; "Allow and start" calls the existing `sensors.js` start path; denied states use the §4 wording.
9. **`web/index.html` + `web/analysis.html`: 5 tabs.** `.tabbar` → `repeat(5, …)`; tabs Map, Plan, Log, Stages, Crew. Plan = today's route panel; Log = `analysis.html?tab=log`; Stages = `analysis.html?tab=stages`; Crew = new `data-view="crew"` panel. Gear plate on the map opens the Settings sheet (today's setup panel minus account). Delete the DRIVES panel and the CLOSE key (swipe/scrim/tab still close).
10. **`web/index.html`: Crew view.** Move `renderAccount()` output into `data-panel="crew"`, always visible (signed-out state shows Sign in with Google + Paste invite instead of hiding the section). Order per §4 wireframe; friend rows open a detail with two switches (Scores, Times) instead of three buttons; Delete account becomes red text.
11. **`web/analysis.html`: Log.** Remove `<header>` (h1, subtitle, `.tabs`, "← Cockpit"). Default view = drives list (today's history table, Score right-aligned 26 px); trend chart only when ≥ 3 scored drives; tap a row → today's DRIVE view for that drive with a "‹ Log" back link. Import .csv becomes a secondary button at the top right.
12. **`web/drive_view.js`: drive summary hierarchy.** Score 44 px with `/1000` and the four part bars directly under it; one line "35.6 mi · 46:00 · 30 corners"; delete Top speed, Peak lateral, Peak braking and Climb tiles from the summary (they remain in the lane readout); hide the scrub readout until the first pointer/keyboard scrub.
13. **`web/analysis.html`: Compare as a sheet.** Remove the COMPARE tab; add "Compare with…" in drive detail, preselecting the best other drive on the same road (`Core.compareDrives` already finds it); delete the whole-road delta card; label "Gap over 4 corners: +0.11 s" with `--gain`/`--accent` colours.
14. **`web/analysis.html`: Stages.** Rename Segments → Stages, "Create a segment" → "New stage", "Passes" → "Runs", "Friends board" → "Board"; move the sharing controls next to the Board; replace the inline `.gain { color: #3FB950 }` with `var(--gain)`.
15. **`web/index.html`: first run.** Three full-screen steps per §4 (logo.svg inlined on step 1, voice samples via the existing `voiceTestBtn` path on step 2, sign-in links on step 3); store `apex.onboarded=1`; "Watch a replay" loads `dry_ridge` and closes onboarding. Do not show the camera-offline toast until a route is opened by the user.
16. **`web/index.html`: Plan panel.** Highlights → Spots; HIGHLIGHTS ON/OFF + PULL slider → one "Detour: Off / Little / Some / More" choice (maps to `hlOn=false` / `hlStrength` 0.5 / 1 / 2); stars select + kind select stay, "ADD" → "Add a spot here"; after a route is built, render the §4 route card with "Drive it" (primary) and "Preview" (secondary).
17. **`web/index.html`: pace-note strip text.** `subFor()` returns `R 42 m · 31 mph` for corners, `Driven once` / `Confirmed` for hazards, `Camera` for cameras; the next-note mini tulip drops its repeated code label; in `instruments.js` Roadbook boxes show the code only when it differs from the call (avoid "R1 / RIGHT 1").
18. **`web/drive_view.js`: corner label collisions.** Draw a corner number only if it is ≥ 18 px from every already-drawn label, otherwise a 4 px dot; apply to the Compare plan map too.
19. **`web/themes.js`, `web/instruments.js`, `web/index.html`: delete Instrument and Telemetry.** Remove both theme objects, the `telemetry` cluster renderer and notes renderer, and all `.tm-*` and `.cluster-telemetry` CSS; map saved `theme: 'instrument'|'telemetry'` to `stage`.
20. **`web/index.html` + `web/analysis.html`: fonts.** Google Fonts link becomes `family=Barlow+Condensed:wght@600;700;800&family=Inter+Tight:wght@400;500;600&display=swap`; `themes.js` FONTS: Road book ui = Inter Tight, num = Barlow Condensed; Instruments ui = Inter Tight, num = Barlow Condensed.
21. **Both pages CSS: button hierarchy and targets.** Implement §5 button table: `.key` 28 → 44 px, `.ink-btn` 38 → 44, `.ink-btn.solid` 48, new `.btn-record` (red, 52); `.ink-btn.on` (selected) = ink fill, not accent; analysis `select, input, button.btn` 34 → 44; `.dv-z` 30 → 44. Delete `.ink-btn.busy::before` and `@keyframes sweep`.
22. **`web/index.html`: Settings sheet.** Voice chips George, Emma, Daniel, Michael, My voice, Phone voice + one "▶ Sample" text button; delete the Jarvis option from the list; LIVE becomes a "Speak road names" switch with a status sentence under it; move licence text to Sources; "Camera feel" → "Map motion: Steady / Lean / Whip".
23. **`web/index.html`, `web/analysis.html` `<head>`: names and icons.** Titles "Vetta" and "Vetta · Log"; `<link rel="icon" href="brand/mark.svg" type="image/svg+xml">`; `<link rel="apple-touch-icon" href="brand/icon-180.png">` after rasterising `brand/icon-180.svg` to 180×180 PNG; for the iOS shell, add an `Assets.xcassets/AppIcon.appiconset` with a 1024×1024 PNG of the same art and list it in `project.yml` sources (it has no icon today).
24. **Both pages: inline style cleanup.** Replace every `style="margin-top:6px"`, `style="display:grid;gap:6px"` etc. with three utilities (`.mt-8`, `.stack-8`, `.stack-12`) on the 4 px grid; section = title + `border-top: 1px solid var(--hair)`, drop `.panel` borders on phones.
25. **`web/index.html` + `web/sync.js`: Crews UI.** In Crew: "New crew" (name), crew detail with members, "Invite to crew" (uses the existing `crew_invites` API), Share switches per crew identical to per-friend ones; Board filter chips "Friends / <crew name>" on the stage Board.

None of these items touch `web/apex_core.js` or `/core`. Run `pytest tests -v` after each batch
anyway: some tests scan files under `web/` (the fabricated-data and espeak-ng guards).
