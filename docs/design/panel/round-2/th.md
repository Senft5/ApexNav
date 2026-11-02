# Theo Marchetti, the platform designer: round 2

Evidence: recording 7 (`scratchpad/r7`), the code on main (`CarPlay/*.swift`, `LiveActivity/*.swift`, `ApexNavApp.swift`,
`UITests/ReviewFlows.swift`), read only. Paths are relative to the pack.

## First impressions

The car card is a glance now. `guided-drive/car/007` says "Careful, hairpin left" on two lines with the tulip in the
card's ink, `car/044` "Easy right" on one, `car/002` "Careful, tight right". That was my P1 last round and it landed as
specified: the 24-character cut in `ApexCarPlay.swift:563` is the right rule for a template that picks the longest
variant that fits. The phone cockpit held: `guided-drive/phone/009` (0.4 MI, tulip, HAIRPIN LEFT, CAREFUL · LONG in red
one size down, "1.7 MI · EASY L" in its own cell) is still the best road-book strip on iOS, landscape has words
(`phone/018`), and Undo in the status row (`phone/285`) is the honest 5 seconds. Dynamic Type still grows the prose and
leaves the dials alone (`dynamic-type/phone/011` against `003`); the I-1 dispute is settled by the pictures.

Now the pictures I asked for exist, and they say what I feared. The lock screen (`phone/213`) is Apple's grey rectangle
with system type, "Open left / Dry Ridge Rd / 0.2 MI / 19 min left", no tulip, no paper, no red pen, and iOS's own
"Allow Live Activities from Vetta?" sheet on top of it, so the first thing a driver's lock screen says about Vetta is a
permission question over a card that could be any app's. The island's expanded view (`phone/210`, `211`) is three lines
of San Francisco on black. The compact view (`phone/212`: "900 FT" and "TIGHT R" around the sensor) is exactly right and
the one native surface that speaks the app's language.

Two things are still unproven after two recordings. The Dashboard and the cluster, the owner's own ask, have no frame
in any flow; the call sheet says built, the pack says nothing, and from code the cluster still ignores the car's
compass and speed-limit settings (`ApexCarPlay.swift:770`, `:771`) and draws the sight plate like every other car map.
And the phone still has no status bar in 580 frames (`ApexNavApp.swift:81`); the planning flow's app left the screen
during the route-bar drag (`planning/phone/007` to `009` are the home screen) and nobody can say from the pack whether
it crashed or was sent home, because the rig keeps no crash log.

Small and true: the theme cards in the Garage still preview "LEFT 4 / TIGHTENS" (`tabs/phone/025`,
`tapedeck-night/phone/001`; `web/cockpit.js:5036`), the notation round 1 retired. The free drive's car card is still a
40 pt record key in the maneuver slot (`free-drive/car/002`, `009`). The Tapedeck quiet line wraps "MI" onto its own
line (`tapedeck-night/phone/040`). The drive-ended card's score as three dots over "/1000" (`guided-drive/phone/286`)
is the right way to say "not yet"; keep it.

## Proposals

### TH-1. The lock screen and the island drawn as the road book

- **Why.** The pack finally has the frames. `guided-drive/phone/213`: `.title3` on `Color(white: 0.09)`
  (`ApexLiveWidget.swift:38`), route name in `.caption`, no tulip, no theme. `phone/210`: the expanded island is the
  same card in black; "20 min left" is `.caption` secondary, the smallest text on the phone while driving. The content
  state (`ApexDriveAttributes.swift`) carries note, distance, eta, short, hazard, trail: no theme, no corner code, no
  tulip id. Apple features Live Activities that look like their app (Flighty, Apple Maps), and every reviewer who
  locks the phone during a drive will see this card before any cockpit. It is the one native surface a passenger and a
  parked driver see, and it says nothing about Vetta.
- **Build.** (1) `ApexDriveAttributes` gains `theme` ("roadbook", "tapedeck", "billet"), `night: Bool` and `code`
  (the strip's `noteCode`: "R2", "LHP", "SQ L", "CREST", "KEEP R"). `web/cockpit.js` sends them in the existing
  `start`/`update` dicts (`ApexNavApp.swift:1037`). (2) In the extension, a `TulipShape: Shape` drawing the code set as
  `Path` (the same glyphs the strip draws), and three palettes as constants: paper `#EDE4D3` / ink `#1C1A17` / red
  `#C8102E` (night: `#151310` / bone), VFD teal on black with amber modifiers, bone on graphite with red numerals.
  Lock screen: distance numeral large and condensed left, tulip centre, call in caps right, the code under the
  distance, the ETA in the theme's secondary ink; a hazard turns the keyline orange as the island already does.
  Expanded island: the same lockup in the bottom region; leading = distance, trailing = code. Compact stays as is.
  (3) The rig taps "Allow" on the Live Activities sheet before the shot (`ReviewFlows.swift:273`, `lockScreen`), so the
  frame shows the card, not the question. (4) A snapshot test renders the three themes at 390 pt and pins them.
- **Cost.** M.
- **Done looks like.** `phone/213` reads like `phone/009`'s strip on paper (or VFD, or graphite); `phone/210` shows the
  tulip; the Allow sheet is gone from the pack.

### TH-2. The car's sight plate stops looking like a speed-limit sign, and never enters the cluster

- **Why.** `guided-drive/car/007`: a white plate with a black 2 pt border, an eye and "20 MPH" sits under the car,
  exactly where Apple Maps draws the speed limit, in the limit sign's colours (`ApexCarMap.swift:589`,
  `palette = (.white, .black)`). At 55 mph with "20 MPH" in a white box under your car, the honest reading is "limit
  20". `car/272` and `free-drive/car/009` show the quiet form: an empty bordered box with an eye in it, a mystery glyph
  on a screen that is supposed to carry only the map. The phone says "OPEN" in words (`phone/034`), so the two screens
  disagree about the same value. The cluster draws the same plate (`showSight` runs for every role,
  `ApexCarPlay.swift:816`, `:853`), in front of the driver next to the car's own speedometer; Apple's cluster rules say
  draw the speed limit only when the car asks, and the delegate that would tell us is empty (`:770`, `:771`).
- **Build.** `ApexCarSightView.set`: palette = the map's plate ink on the theme's dark plate (the hazard plates'
  `UIColor(white: 0.067)` at `:441`, with the card's ink), never white-on-black-border; "SIGHT" in 9 pt caps above the
  number so it names itself; OPEN draws nothing at all (no empty box). Cluster role: `showSight` is a no-op, hazard
  plates at most one on screen. Implement `didChangeCompassSetting` (a compass glyph top right when `.enabled`) and
  `didChangeSpeedLimitSetting` (the page's limit as the white sign, only when `.enabled`; "--" never drawn). A test
  asserts the cluster map receives no sight call.
- **Cost.** S.
- **Done looks like.** `car/007`'s plate reads "SIGHT 20" in the map's ink on a dark plate; the quiet frames show no
  plate; the cluster, when photographed, shows route, arrow and corner codes only.

### TH-3. The phone gets its status bar back, and the home indicator is honest

- **Why.** 580 phone frames and not one clock, battery or signal (`ApexNavApp.swift:81` hides the status bar app-wide,
  `:82` the home indicator). The status row gives the arrival ("11:21 PM", `phone/009`) and never the time; a driver
  with the phone in a cradle has no clock in the car at all. Apple Maps, Google Maps and Waze all keep it in guidance.
  The page already lays out under the notch (`--safe-top`), so nothing moves. New this round: the planning flow's drag
  from the route bar (`ReviewFlows.swift:396`) ended on the home screen (`planning/phone/007`); with the home
  indicator hidden, iOS's first bottom-edge swipe is the system's, not the app's, and the app lost it. Hiding the
  indicator buys nothing on the Map tab, where the tab bar sits above the edge.
- **Build.** `.statusBarHidden(false)`; the page's existing `look` message sets the style (light content on Tapedeck,
  Billet and night; dark on Roadbook day). `persistentSystemOverlays(.hidden)` only while `shell.driving`; visible on
  every other screen. The rig saves the simulator's crash logs (`~/Library/Logs/DiagnosticReports`) into the pack when
  an app leaves the screen, so next round can say crash or gesture.
- **Cost.** S.
- **Done looks like.** Every phone frame shows the clock top-left in the theme's ink; the route-bar drag opens the card.

### TH-4. The free drive's car card is the mark and the road, not a record key

- **Why.** `free-drive/car/002`: a 40 pt `record.circle` in the maneuver symbol slot with "Recording"; `car/009`:
  "Rec · 0.8 mi driven" on two lines, the glyph unchanged, "-- / --" in the arrival and minute cells for the whole
  drive. A maneuver symbol that is not a maneuver is the one thing App Review checks the navigation templates for
  (`docs/APP_REVIEW.md` already carries the fallback), and a red disc at that size reads as a key on a screen where
  the only keys are Apple's. Round 1 gave it no points; it is still the cheapest App Review risk in the car.
- **Build.** `ApexCarPlay.swift:576` `recordingGuide`: symbol = the Vetta mark (the tulip from `LaunchLogo`) in the
  card's ink at 32 pt, not a system symbol; instruction variants = "Dry Ridge Rd" (from the page's `roadAt`) with
  "Rec · 0.8 mi" as the second, shorter form; street = "Recording". Strip: pass no `CPTravelEstimates` to the trip until
  there is a distance driven, then distance only (as now) with time `-1`.
- **Cost.** S.
- **Done looks like.** `car/002` shows the mark and the road on one line; no frame shows three dashes.

## Did round 1 land?

T-1/I-4 landed exactly: `car/007`, `044`, `002` are glances. I-3's Undo (`phone/285`, `tapedeck-night/phone/104`) and
the Sunday deck (`tabs/phone/029`) are there and right. One notation did not reach the Garage's theme previews
("LEFT 4 / TIGHTENS", `tabs/phone/025`). T-6's rig fix half-held: Billet still has no photos, now for a different
reason ("Roadbook's card has no Use key", `billet/app-log.txt`), and the Dashboard has none for the second round.

## What I'd protect

1. **The strip and the car card's glance rule**: `phone/009`, `phone/018`, `car/007`. The 24-character cut, the tulip in
   the card's ink, the whole call left to the voice. Do not let any proposal add a line back to the card.
2. **The island's compact view and the three-dot score**: "900 FT · TIGHT R" around the sensor (`phone/212`) and
   "● ● ● /1000" on the end card (`phone/286`). Both say less, in the system's own slot, and never invent a number.
