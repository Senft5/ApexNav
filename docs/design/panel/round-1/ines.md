# Ines Duarte, safety and access: round 1

Evidence is recording 6 (`scratchpad/r6`), the code on main, and the pack's `contrast.md`. Paths are relative to the
pack. I rank unsafe above everything, then the people the app shuts out, then polish.

## First impressions

I spent two careers getting drivers to look at the road instead of a screen, so I open a navigation app the way a
crash investigator opens a car: where are the eyes, where are the hands, and what happens when either slips. By that
measure Vetta's drive is mostly right, and right in the way that is hard to do. The co-driver is a voice, and it leads:
"Tight right, careful" 850 ft out at 67 mph, eight seconds, then nothing on the straight, and it says so. A driver who
never glances at the phone still gets the product. That is the correct architecture for driver distraction, and almost
nobody builds it, because it is easier to make a screen than a co-driver. The screen under it keeps the big things big
(a 70 px speed numeral, a 24 px call, a map with one route), the Report sheet is six large plates, one tap, no confirm,
undo in the status row, and typing locks when the car moves. The hazard plate is black, orange edge, triangle: two
channels, hue and shape, in every theme. Someone thought.

Then I turned the text size up, which is the first thing I do with any app, because one in four people over fifty
does. Nothing happened. I launched the dynamic-type flow at the largest accessibility size and compared it frame for
frame to the normal-size flows: the Garage, the Log, the route card, People, pixel for pixel the same. The app's own
App Review file says "Dynamic Type on reading pages". It is not there. For a low-vision driver that means the route
card, the one page they must read before the drive, is 15 px prose that no system setting can enlarge, and the web view
is pinned so a pinch does nothing either. That is not polish; it is a door that is painted on.

Two things in the drive itself I would not sign off. End is one tap with no undo and sits a finger's width from Report,
the key you reach for on a bad road. And the CarPlay card still prints the whole hairpin call on four lines for half a
mile, which is not a glance, it is a paragraph; the fix for it is in the code and does not take on the car.

What I'd tell a friend: use it, with the voice on and the phone in a mount you do not need to look at. If you wear
glasses to read, wait a round.

## The contrast pass (`contrast.md`), read closely

- **Real failure:** Roadbook day, `--face-dim` #736A5A on #EDE4D3 at 4.22:1 on "MPH", "BRAKE" and ".5" (`.dial-label`,
  `.dial-tiny`). One token. #665E51 on that paper is about 5.2:1 and still reads as pencil. Night, Billet and Tapedeck
  pass everywhere measured.
- **Artefact, not failure:** the two 1:1 rows (`.dial-digital.vfd-shadow`, "60" on black) are Tapedeck's hidden text
  node under the seven-segment digits, the one the screen reader and the contract read (`web/instruments.js:413`). It
  is meant to be invisible. The pass should skip it, or the next reviewer will chase a ghost.
- **What the floor missed:** "Speed limit" on the Limit sign is 7 px in every theme, `.sight-tag small` ("MPH" on the
  plate under the car) is 9 px, the map credit 10 px, `.rb-dist small` and `.dial-tiny` 11 px. The contract says nothing
  under 13 px on the binnacle (`web/theme_contract.js` FLOORS), and `e2e/smoke.js:2960` lists nodes under 13 px, so
  either the sign's caption is excluded or the list is not failing the run. The sign's caption is a real sign's small
  line and can stay small only if it is decoration to a reader as well (`aria-hidden`), and 9 px on the sight plate is
  not decoration.
- **Not measured, and should be:** the sight plate on the map in both states, the hazard plate, the route red on
  paper, and the car's plates (R3, L1, the sight plate on black). The drive screen's warnings live on the map, not on
  the panel, and the pass only reads the panel.

## Proposals

### I-1: Dynamic Type actually does something on the reading pages

- **Why.** The dynamic-type flow was launched at `UICTContentSizeCategoryAccessibilityXXXL`
  (`UITests/ReviewFlows.swift:499`) and every page is identical to its normal-size twin: `dynamic-type/phone/012-route-card.png`
  against `planning/phone/003`, `010-garage.png` against the Garage in signed-in, `009-log.png`, `011-people.png`. In code
  there is no `-apple-system-body`, no content-size hook in `ApexNavApp.swift`, the viewport is `user-scalable=no`
  (`web/index.html:6`) and the scroll view is pinned to zoom 1 (`ApexNavApp.swift:344`). `docs/APP_REVIEW.md:40` claims
  "Dynamic Type on reading pages (U-15)"; the claim is untrue and a reviewer with Larger Text on will see that in one tap.
  WCAG 1.4.4 (resize text to 200 %) fails on every page.
- **Build.** In the shell, read `UIApplication.shared.preferredContentSizeCategory` at launch and on
  `UIContentSizeCategory.didChangeNotification`, and post it to the page (`apex.textSize = "ax3"` plus a numeric scale,
  1.0 for Large up to about 1.9 for AX5). In `web/index.html`, the reading surfaces (`.sheet`, `.plan-body`, the route
  card's prose and facts, `.end-line`, the Log, People, Garage, the hazard sheet labels) set their type with
  `calc(<px> * var(--text-scale))` and their row heights with `min-height`, not `height`; the stats grid on the route
  card wraps to two columns past 1.4. The cockpit (strip, binnacle, map keys) does not read `--text-scale`; that is I-2.
  Update `docs/APP_REVIEW.md` 4.0 to say what is true, and make `test09DynamicType` assert the Garage's body text box is
  at least 1.5× taller than the normal flow's.
- **Cost.** M.
- **Done looks like.** `dynamic-type/phone/010-garage.png` has visibly larger prose than the signed-in Garage, the route
  card's facts wrap to more lines, and the drive-screen frames in the same flow are unchanged.

### I-2: A large cockpit, for mounts and for eyes

- **Why.** The call head is 24 px (`web/index.html:172`), the modifiers 16 px red caps, the Sight word 16 px, the Limit
  caption 7 px, the sight plate's unit 9 px. On an iPhone 16 Pro a 24 px condensed cap is about 3 mm; at a dash mount's
  65–75 cm that is 14–16 arcminutes, under ISO 15008's 20-arcminute minimum for in-vehicle text, and the 16 px
  modifiers ("ALMOST BACK ON ITSELF · LONG · CAREFUL", `guided-drive/phone/009-driving.png`) are about 10. The speed
  numeral at 70 px is fine; the thing the screen exists for is not. Review 5 was right that accessibility sizes must
  not wreck the strip (its §5), so the answer is not scaling: it is a second, designed size.
- **Build.** `html[data-cockpit="large"]`: head 32 px, one call per line, modifiers as the strip's codes (R3, LONG,
  CARE) at 20 px, the next cell code only, Sight and Limit values 20 px, `.dial-tiny` dropped, the status row one line
  ("Rec 1.4 mi · 30 min · 8:11"), Report and End 56 px tall. Chosen automatically when the content size category is an
  accessibility size (from I-1's hook), and offered in Garage > Look as "Cockpit size: Standard / Large". The theme
  contract gets a second set of floors for large and `e2e/smoke.js` runs its drive-screen checks in both.
- **Cost.** M.
- **Done looks like.** The dynamic-type flow's cockpit frames show the large layout with no cut word and no overlap in
  portrait and landscape; the normal flows are unchanged.

### I-3: End can be undone; it cannot be a mis-tap

- **Why.** `#driveEnd` (`web/index.html:1472`) goes straight to `leaveDrive(true)` (`web/cockpit.js:6269`): no hold,
  no confirm, no undo. It sits 6 pt from Report (`guided-drive/phone/009`), the key a driver reaches for on the roughest
  road at the worst moment, often with the hand that is bouncing. One wrong tap ends the recording, silences the
  co-driver mid-stage and files a drive. A modal "Are you sure?" would be worse (a dialog while moving is exactly what
  NHTSA's guidelines count against); the right pattern is the one the app already uses for hazards: do it, say so,
  offer Undo for five seconds.
- **Build.** On End, keep the sensor pipeline and the notes running and show "Drive ended · Undo" in the status row
  with a 5-s fill; commit `leaveDrive` only when it lapses or the driver taps elsewhere; Undo resumes with nothing lost.
  The same on the car's End (`free-drive/car/020`) via the CarPlay alert's one action. Haptic on End so a mis-tap is
  felt. Report moves to the left end of the row, End to the right edge with 16 pt between them.
- **Cost.** S.
- **Done looks like.** A frame after End shows the status row "Drive ended · Undo" with the strip still live; the
  drive-ended card appears only after the five seconds.

### I-4: The car card says the glance form, because the long form never leaves the card

- **Why.** `guided-drive/car/005` to `011`: "Very sharp left, almost back on itself, long, careful" on four lines from
  0.5 mi to 100 ft. Review 5's U-112 fix exists (`web/carplay.js:98` `cornerShort`, `CarPlay/ApexCarPlay.swift:541`
  puts the short form first), and the card still shows the long one: CarPlay takes the longest variant that fits its
  card, and a four-line card fits it. A 2-s glance reads five to seven words; this is nine.
- **Build.** `guideChanged`: `instructionVariants` carry only forms of at most `GLANCE_MAX` characters (the short forms
  and the street), never the full call; the full call stays the voice's. Dashboard variants the same. The CarPlay test
  pins "no variant over 24 characters for a corner".
- **Cost.** S.
- **Done looks like.** `car/007` reads "Very sharp left, careful" on two lines.

### I-5: One red, and no warning that is hue alone

- **Why.** On `guided-drive/phone/009` red is: the Rec dot, the needle, the limit marker, BANK, "Open" in the Sight
  cell, the modifiers, and the route. The one red that is a warning, "faster than you can see", changes hue only:
  `.sight-tag.short` fills the plate red (`web/index.html:480`) and `.ro-sight.short` reddens the cell (`:446`). About
  one in twelve of Vetta's drivers (men, mostly) has a red-green deficiency; for them red on this paper is olive, like
  the ink. On the car the sight plate is a white rectangle, a number and "MPH" under the arrow
  (`guided-drive/car/003`: "85 MPH"), which in a glance is the shape of a speed-limit sign. Review 5's pushback on the two
  reds is on record; this is the access side of the same thing.
- **Build.** The Sight cell is ink until over-speed (REVIEW5's ask). The over-speed state uses two channels in every
  surface: the plate and the cell take a hatched 2 px border and the eye glyph gets a bar through it, and the cell says
  "SLOW" under the number; the haptic ('hazard' pattern) fires once on entry. On the car the plate loses "MPH" and keeps
  the eye and the number on the dark panel colour, so it stops looking like a sign. The theme contract gains a rule: a
  warning state changes hue and shape, and `web/theme_contract.js` checks the signal token against the panel at 3:1 as
  a non-text contrast floor. Also in this PR: the Roadbook day `--face-dim` fix from the contrast notes above.
- **Cost.** S.
- **Done looks like.** Converted to greyscale, the over-speed frame still differs from the open one; `contrast.md` has
  no row under 4.5:1.

### I-6: A VoiceOver pass on the five reading pages and the drive screen, with a test

- **Why.** The reading pages have good bones (tablist, radiogroups, dialogs with `aria-modal`, labelled keys), and
  `docs/STATE.md:454` says plainly it has never been tried with VoiceOver. The drive screen has not been labelled at
  all: `web/instruments.js` has five aria attributes in 578 lines, none on the strip or the Roadbook dial, so VoiceOver
  reads the printed dial as "20 40 60 80 100 120 MPH 70" and the strip as loose words. And one modal is not modal: in
  `dynamic-type/phone/010-garage.png` the drive-ended card is drawn over the Garage page after the Log tab was used,
  Done still at the bottom, the gear behind it; a dialog that lets the tab bar through under it also lets a screen
  reader through.
- **Build.** The strip is `role="status"` with an `aria-label` rebuilt in `renderNotes` ("550 feet, very sharp left,
  almost back on itself, long, careful; then 1.4 miles, left five minus"); the printed dial and the g-ball are
  `role="img"` with a label like Tapedeck's (`instruments.js:423`); the Sight cell's label says the state in words; the
  end card either traps focus and hides `#tabbar` or closes on any tab change. A `testAccessibility` in
  `UITests/AppTourTests.swift` runs `performAccessibilityAudit()` on the idle map, the route card, the drive screen, the
  end card, the Log and the Garage, and fails on contrast, label and Dynamic Type issues.
- **Cost.** M.
- **Done looks like.** A VoiceOver transcript of the route card and the end card in the pack reads as sentences, and
  no frame shows the end card over another page.

## What I'd protect

1. **The voice leads and the screen follows.** Lead times of four to nine seconds, the quiet line that says it is
   quiet, "careful" twice in nine minutes and never more. This is what keeps eyes on the road; no feature should
   compete with it for the driver's ears.
2. **The Report sheet and the moving lockout.** Six large plates, one tap, no confirm, Undo in the status row; typing
   locks while moving with a one-tap passenger override that says what it did. Keep both exactly as they are.
3. **The hazard plate contract.** Black, orange edge, triangle, same place in every theme, day and night: the one
   warning in the app that already uses two channels. It is the pattern I-5 asks the rest of the drive screen to copy.

Notes on the pack: the tabs flow's Log, People and Garage steps still photograph the replay (`tabs/phone/028-garage.png`
is "Replay finished · 788"), Review 5 §7.2; and the dynamic-type flow should add one landscape frame and the hazard
sheet, which are the two places a large cockpit is most likely to break.
