# Theo Marchetti, the platform designer: round 1

Evidence: recording 6 (`scratchpad/r6`), the code on main (`CarPlay/*.swift`, `LiveActivity/*.swift`,
`ApexNavApp.swift`, `web/carplay.js`), read only. Paths are relative to the pack.

## First impressions

I spent nine years making templates so that apps like this one would look like they belong in a car. Vetta's phone
cockpit is better than most of what those templates were built to protect drivers from: the strip at the top of
`guided-drive/phone/009` (550 FT, the tulip, VERY SHARP LEFT, the modifiers in red one size down, "1.4 MI · L5-" in its
own cell) is a road book, not a web page pretending to be one. The binnacle underneath it is the one piece of this app I
would put in a keynote. The welcome (`first-run/phone/001` to `007`) is one screen, one key, no sign-in wall. The
location prompt comes over the map with a reason on it (`008`). Dynamic Type now grows the prose and leaves the
instruments alone (`dynamic-type/phone/009` against `003`), which is exactly the right reading of the setting and almost
nobody gets it right. The phone on its side has words again (`guided-drive/phone/017`, `018`). This is craft.

Then I step out of the cockpit, and every native surface Apple gives this app is Apple's furniture with Vetta's name on
it. The lock screen Live Activity is a fixed grey tint, system fonts and no tulip (`LiveActivity/ApexLiveWidget.swift:38`,
read in code; the pack has no lock-screen frame). The home-screen widget is a `steeringwheel` SF Symbol on
`.fill.tertiary` (`ApexQuickWidget.swift:25`, `:51`): it could be any app on the store. The Dashboard shortcut buttons are
`magnifyingglass` and a system arrow (`ApexCarPlay.swift:679`). And the car's guidance card, the one surface a driver
reads at speed, still prints "Very sharp left, almost back on itself, long, careful" on four lines for half a mile
(`guided-drive/car/005` to `011`) after U-112 was built, because CarPlay doesn't read `instructionVariants` the way the
fix assumed. I'll be exact about that below; it is the cheapest P1 on the list.

Two things the pack can't tell me, and I won't pretend it can. The Dashboard and the cluster, the thing the owner asked
for and the call sheet says is "just enabled", have zero frames in nine flows: judged from code only, the manifest move is
right and the rest is unproven. And the Billet flow is Roadbook in all 108 photos (`billet/phone/001-theme-billet.png`
is the Map tab with a route bar; `060-driving.png` is paper and ink), so Billet is unjudged this round.

What I'd tell a friend: the phone screen is the best road-book cockpit on iOS, and every other surface Apple hands this
app (car card, lock screen, widget, Dashboard) is a week of native work away from matching it. Cheap, all of it. That
is the good news and the embarrassment in one sentence.

## Proposals

### T-1. The car card gets only words that fit a glance

- **Why.** `guided-drive/car/005`, `006`, `007`, `008`, `009`, `010`, `011`: "Very sharp left, almost back on itself,
  long, careful" on four lines of the guidance card from 0.5 mi to 100 ft. U-112 put the short form first in
  `instructionVariants` (`CarPlay/ApexCarPlay.swift:541`), and `web/carplay.js:186` does build it ("Very sharp left,
  careful", "Very sharp left"). But CarPlay does not pick the preferred variant; it picks the **longest variant that
  fits** the card, and on an 800-pixel display the whole call fits on four lines. So the long form wins every time.
  `dashboardInstructionVariants` (`:547`) carries the long form too, on a card a third of the screen wide. A glance is
  two seconds; four lines are not a glance.
- **Build.** `ApexCarPlay.swift` `guideChanged`: when `g.short` is non-empty, `instructionVariants = g.short` (the
  short forms, longest first) and never the full instruction; the voice says the full call, the card says the glance.
  `dashboardInstructionVariants = [g.short.last]` plus the street. For turns, `shortForms` already drops the road.
  Keep a test in `tests/` that no variant sent to the card exceeds `GLANCE_MAX` when a short form exists.
- **Cost.** S.
- **Done looks like.** `car/005` reads "Very sharp left, careful" on two lines at most; the Dashboard card one line.

### T-2. The lock screen, the island and the widget drawn as the road book

- **Why.** Outside the cockpit Vetta is system-default: `ApexLiveWidget.swift:27` sets the call in `.title3` over a
  fixed `Color(white: 0.09)` tint with the route name in `.caption`; no tulip, no theme, no red pen. The island's
  compact view is right now (`guided-drive/phone/019`: "100 FT" and "R2" each side of the sensor) and should stay. The
  widget (`ApexQuickWidget.swift`) is a steering-wheel symbol on tertiary fill, with `Text("Vetta")` to say whose it is.
  A platform designer sees these as the app admitting the brand lives only in a web view. Apple features Live Activities
  that look like the app; Flighty's and Apple Maps' are drawn in their own language. The pack has no lock-screen frame
  (REVIEW5 §7.9 asked), so the lock screen is also unproven.
- **Build.** (1) `ApexDriveAttributes` gains `theme` ("roadbook", "tapedeck", "billet") and `night`; the extension
  carries the three palettes as constants (paper/ink/red, VFD teal on black, bone on graphite). (2) A native
  `TulipShape` in the extension drawn from the code (`R2`, `L5-`, `HPL`, `CREST`, `KEEP R`: the same glyph set the
  strip uses, as `Path`), so the lock screen shows distance numeral, tulip, call, code in the theme's ink, with the
  hazard plate's black/orange for a hazard. (3) The widget: the record key (red, white dot) and the mark from
  `Assets.xcassets/LaunchLogo`, Roadbook paper; a second family "Loop from here · 45 mi" opening
  `apexnav://open?go=loop` (`ApexIntents.swift` already handles links). (4) The recording locks the phone once during a
  call (`simctl` lock) and photographs it.
- **Cost.** M.
- **Done looks like.** A lock-screen frame in the pack that reads like `guided-drive/phone/009`'s strip; a widget frame
  that reads as Vetta before the name.

### T-3. Give the phone its status bar back

- **Why.** Not one of the 562 phone frames has a clock, battery or signal: `ApexNavApp.swift:80` hides the status bar
  for the whole app, and `:81` the home indicator. Apple Maps, Google Maps and Waze keep the status bar in guidance; a
  driver wants the time and the battery while navigating, and the drive status row says the arrival ("8:11 PM",
  `guided-drive/phone/009`) but never now. REVIEW4 §10 and `docs/REVIEW_RECORDING.md:77` have had to work around the
  missing clock to time the recordings. The page already lays out under the notch (`--safe-top`, `web/index.html:314`),
  so nothing moves.
- **Build.** `statusBarHidden(false)` on `ApexShellRootView`; a `look` message from the page (it already sends the theme
  to CarPlay) sets the style, light content on Tapedeck, Billet and night, dark on Roadbook day; keep the home
  indicator hidden only while driving (`persistentSystemOverlays` tied to `shell.driving`).
- **Cost.** S.
- **Done looks like.** Every phone frame has the clock top-left, in the theme's ink.

### T-4. The cluster and the Dashboard as Apple means them, and photographed

- **Why.** The pack has no Dashboard or cluster frame; the call sheet (2026-11-01) calls the Dashboard built. From the
  code: the cluster delegate ignores the car's compass and speed-limit settings (`ApexCarPlay.swift:725`, `:726`), and
  every car map, cluster included, draws the sight plate (`showSight` runs for every role, `:859`). A "20 MPH" plate in
  the instrument cluster, in front of the driver, next to the car's own speedometer, reads as a limit. Apple's cluster
  rules: draw the compass and the speed limit only when the car asks, nothing that looks like a control, and keep the
  map legible at the cluster's size. The Dashboard map is laid out with no card inset (`setMode`, `:879`, inset 0 for
  `.dashboard`), which is right only if Apple's cards never overlap the window; on some head units they do.
- **Build.** `ApexCarMap.swift`: the cluster role draws route, arrow and corner codes only (no sight plate, no hazard
  plates over 1 per screen); honour `didChangeCompassSetting` and `didChangeSpeedLimitSetting` (a compass glyph top
  right when `.enabled`; the Limit sign when asked, from the page's limit). Dashboard role: respect
  `view.safeAreaInsets` for the camera's centre. Then the proof: the CarPlay Simulator app (Additional Tools) shows the
  Dashboard and the cluster; if CI's Mac can't drive it, the owner's two photos from the car go in the pack as
  `car/dashboard.png` and `car/cluster.png` (OWNER_TODO).
- **Cost.** S for the code; the photographs are the owner's.
- **Done looks like.** A Dashboard frame with the map left, the short call top right, no sight plate in the cluster.

### T-5. The free drive's record card says the road, not a record button

- **Why.** `free-drive/car/002`: a 40 pt red `record.circle` in the maneuver symbol slot, "Recording · the road ahead",
  and a trip strip "-- arrival · -- min · --". By `005` to `019` the strip is "-- · -- · 1.2 mi": two dashes for five
  minutes. The record glyph at that size looks like a stop key on a screen where the only keys are Apple's; a reviewer
  reads a maneuver symbol that is not a maneuver (`docs/APP_REVIEW.md` already carries the fallback).
- **Build.** `ApexCarPlay.swift` `recordingGuide` and `web/carplay.js` `recordingMessage`: symbol = the Vetta mark (the
  sidebar icon's tulip) in card ink at 32 pt; words = "Dry Ridge Rd · 1.2 mi" (the road from `roadAt`, the distance
  driven), "Recording" as the street variant. Strip: time driven in the time slot is a lie, so keep "--" for time and
  distance driven in the distance slot (as now), and drop the arrival cell by passing no `CPTravelEstimates` until
  there is a distance. Nothing else is honest within the template.
- **Cost.** S.
- **Done looks like.** `car/002` shows the mark and the road; no frame shows three dashes.

### T-6. A theme the recording can prove took

- **Why.** The Billet flow never left Roadbook: `billet/phone/001-theme-billet.png` is the Map tab with the route bar
  (the test's `tab("Garage")` didn't land), and every drive frame to `108` is paper and ink; the sign-off is
  Marguerite's ("And that's the stage. Score five hundred fifty-seven.", `billet/app-log.txt` 19:43:35), not Hale's.
  `UITests/ReviewFlows.swift:260` asserts the theme took, yet the flow ran on. So the owner's most expensive theme has
  no evidence this round, and REVIEW5's Billet findings (the binnacle's cut road name, U-124) can't be checked.
- **Build.** `web/cockpit.js`: set `document.documentElement.dataset.theme` and expose it as an accessibility value on
  the page root (`aria-label="Theme Billet"` on `#modePlate` or a hidden `role=status`); `ReviewFlows.theme()` waits
  for that value, fails the flow (not the assertion alone) if it is wrong, and shoots the Garage card as the step's
  photo. The tab tap retries once if the tab bar is not hittable.
- **Cost.** S.
- **Done looks like.** `billet/phone/001` is the Garage with Billet "In use"; `002` is black with red numerals.

## What I'd protect

1. **The strip and the binnacle in portrait** (`guided-drive/phone/009`, `billet/phone/060`): fixed height, head in
   words, code in the next cell, the Limit sign as the real sign, "--" where unknown. Do not let any proposal, mine
   included, move a pixel of it.
2. **Dynamic Type's split**: prose grows, instruments don't (`dynamic-type/phone/003` against `009`, `012`). This is the
   correct platform behaviour for a cockpit and it took real work; keep the test that pins it.
3. **The car's quiet plate and the island's compact codes**: the eye alone when the view is open
   (`guided-drive/car/008`, `free-drive/car/009`) and "100 FT · R2" around the sensor (`guided-drive/phone/019`). Both
   are Apple's rules read correctly: say less, in the system's own slots.

One note for the rig, not a proposal: `guided-drive/car/018-landscape-quiet.png` is the car window rotated to 480 × 800
with the phone; a head unit never rotates, so that frame is the simulator's, not the app's.
