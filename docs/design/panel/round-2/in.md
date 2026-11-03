# Ines Duarte, safety and access: round 2

Evidence is recording 7 (`scratchpad/r7`), the code on main and the pack's `contrast.md`. Paths are relative to the
pack. Side-by-side composites I built for the Dynamic Type question are described in the text; every number in them is
a measurement on the pack's own PNGs (1206 × 2622), not an estimate. I rank unsafe above everything, then the people the
app shuts out, then polish.

## First impressions

Round 1 built the two things I would not sign off, and both landed where the camera can see them. End is now a
five-second Undo with a fill bar and the strip still live (`guided-drive/phone/285-drive-ending.png`: "Undo", "Drive
ended.", the notes still calling the next corner 12 mi out), and the car's card finally says the glance form:
"Careful, hairpin left" on two lines at 0.5 mi (`guided-drive/car/007-car-guide.png`), "Easy right" on one
(`car/044`). The voice kept its architecture through the new grammar: warning word first, "Careful, square left, then
medium right in a quarter mile", the quiet line that says it is quiet, and 28 lines in twenty minutes with no aside
inside a braking zone. The lock screen and the island say the one thing a glance needs ("0.4 MI · Open left · Dry
Ridge Rd", `phone/210`, `213`). That is still the correct shape for driver distraction, and it is holding under change.

Then the dispute. I said in round 1 that Dynamic Type did nothing; Theo said the pack showed prose at about 1.7×. I put
the dynamic-type flow beside the same pages from the tabs, signed-in and planning flows and measured. Theo is right
about the Garage and People: the page zooms 1.6× and the instruments stay put, which is the right split. I was right
about the route card, the end card and the drive's page in the Log: pixel for pixel the normal size, the one place
a driver must read before the drive and the one place they read after it. Half a door. The detail is in its own
section below, and the half that is missing is my first proposal.

What has not moved: the Sight number is red in every frame whether you are under it or not, so the one warning on the
drive screen has no colour left to warn with; the car's sight plate is still a white rectangle with a number and MPH,
the shape of a limit sign; `contrast.md` still lists Roadbook day "MPH" at 4.22:1, the second review in a row the call
sheet has said "left for the next review"; and the drive screen has five ARIA attributes in `web/instruments.js`, the
same five. Amara is on the panel now and will say what a screen reader meets better than I can; I will vote for her.

What I'd tell a friend: use it, voice on, phone in a mount. If you read with the text size up, the Garage is yours
now; the route card is not yet.

## The Dynamic Type dispute, settled with a ruler

The flow launched at `UICTContentSizeCategoryAccessibilityXXXL` (`UITests/ReviewFlows.swift:548`), where iOS sets body
text at 53 px against 17 at the default. The page reads that through `-apple-system-body` (`web/format.js:45`) and
turns it into `--type-scale`, capped at 1.6, which `web/index.html:942` applies as `zoom` to `.sheet .body` and
`web/analysis.html:63` to a short list of the Log's blocks. Nothing else reads it. What the photos show:

| Page | Large text | Normal twin | Measured |
|---|---|---|---|
| Garage | `dynamic-type/phone/011-garage.png` | `tabs/phone/025-garage.png` | "Add a photo" key 558 px wide against 348: **1.6×**. Prose, rows and keys all grow; "Who sees what" wraps to two lines and still fits. |
| People | `dynamic-type/phone/015-people.png` | `tabs/phone/023-friends.png` | "Invite or add a friend" key 822 px against 513: **1.6×**. The example row loses its time to an ellipsis ("Dry Ridge R…"). |
| Log, Stages tab | `dynamic-type/phone/010-log.png` | `tabs/phone/022-log.png` | The empty line is 1.6×; the Drives/Stages control is the same 1109 px in both, and the stage form's captions ("Pick a road you drove…") are the unscaled 13 px. |
| The drive's page in the Log | `dynamic-type/phone/007-in-the-log.png` | `tabs/phone/016-in-the-log.png` | Subtitle ink 34 px tall in both; the Replay key, the links and the coaching sentence identical. **1.0×**. |
| Route card | `dynamic-type/phone/016-route-card.png`, `017` | `planning/phone/004-route-card.png`, `005` | Title, prose, facts, dials, route tiles, "Drive it": identical. **1.0×**. |
| Drive-ended card | `dynamic-type/phone/006-drive-ended.png` | `tabs/phone/015-drive-ended.png` | Meta line ink 34 px tall in both; same keys, same links. **1.0×**. |
| Cockpit | `dynamic-type/phone/003-cockpit.png` | `tabs/phone/003-driving.png` | Identical, by design. Right. |

So: Theo's "prose grows, instruments don't" is true of the two tab sheets and part of the Log; my "nothing happened"
was wrong for those and right for the three pages that carry the drive itself. The 1.6 cap also means a person who
asked for 3.1× gets 1.6×, under WCAG 1.4.4's 200 %; on a scrolling page there is no reason to stop at 1.6.
`docs/APP_REVIEW.md:41` says "Dynamic Type on reading pages"; the honest line is "on the Garage, People and the Log's
lists". Dispute closed; the work is not.

## Proposals

### IN-1: Dynamic Type on the pages that carry the drive

- **Why.** The table above. The route card is what a low-vision driver reads before setting off (the call density,
  the climb, the forecast, which route), the end card is what they read when they stop, and the drive's page is where
  the one coaching sentence lives. All three are 15–16 px prose that no system setting touches, while the Garage next
  door is 1.6×. A reviewer with Larger Text on sees the inconsistency in two taps. WCAG 1.4.4 asks for 200 % without
  loss of content; the cap is 160 %.
- **Build.** Apply `zoom: var(--type-scale)` to `#routeCard` (the whole card: title, prose, the stats grid wraps to two
  columns past 1.4 via a `data-large` class set in `applyTypeScale`, the dials row to 2 × 2, the elevation SVG keeps its
  width because it measures itself), to `#endCard .end-card` (the overlay already scrolls in landscape; let it scroll
  upright too), to `#planBody`, and in `web/analysis.html:63` add `#tab-drive`'s text blocks and `#segDetail`'s captions.
  Raise the cap in `typeScale` to 2.0 for everything that scrolls and leave 1.6 only where a page must fit a screen
  (the end card's key row). Rows that truncate with `text-overflow: ellipsis` (the People example row, the drive rows
  in the Log) wrap instead when `--type-scale` is over 1. `test09DynamicType` asserts the route card's title box and the
  end card's meta line are at least 1.5× their planning/tabs twins; `e2e/smoke.js` runs the route card and the end card
  at `--type-scale: 2` and fails on any clipped text. `docs/APP_REVIEW.md:41` names the pages that scale.
- **Cost.** M.
- **Done looks like.** `dynamic-type/phone/016-route-card.png` beside `planning/phone/004` shows the same card with
  visibly larger prose and the stats on two rows; the cockpit frames in the same flow are unchanged.

### IN-2: A large cockpit, chosen when the text size is an accessibility size, and offered in Look

- **Why.** The cockpit is right not to scale (`dynamic-type/phone/003` is the proof that it doesn't), but that leaves
  the driver who needs it with nothing. The head is 24 px condensed caps ("HAIRPIN LEFT", `guided-drive/phone/009`),
  the modifiers 16 px ("CAREFUL · LONG"), the next cell 13 px, the Limit sign's caption 7 px. On an iPhone 16 Pro a
  24 px cap is about 3 mm; at a dash mount's 65–75 cm that is 14–16 arcminutes, under ISO 15008's 20-arcminute
  minimum for in-vehicle text, and the modifiers are about 10. The speed numeral at 70 px is fine; the words the screen
  exists for are not. Grace on this panel is 67 and drives a Buick with bigger text on; today her setting grows the
  Garage and leaves the one screen she will look at while moving exactly as it is.
- **Build.** `html[data-cockpit="large"]`: head 32 px and one call per line, modifiers as the strip's codes at 20 px,
  the next cell code only, Limit and Sight values 20 px, `.dial-tiny` dropped, the status row one line (see IN-4),
  Report and End 56 px tall. Chosen automatically when `--type-scale` is over 1.3 (the hook from IN-1), and offered in
  Garage > Look as "Cockpit size: Standard / Large" for the dash-mount case regardless of text size. The theme contract
  gets a second set of floors for large and `e2e/smoke.js` runs its drive-screen checks in both, upright and on its
  side.
- **Cost.** M.
- **Done looks like.** The dynamic-type flow's cockpit frames show the large layout with no cut word and no overlap in
  portrait and landscape; the normal flows are unchanged.

### IN-3: One red, so that the warning red means something; and the contrast row that has waited two rounds

- **Why.** In every r7 frame the Sight number is red: "45" at 32 mph (`guided-drive/phone/214-landscape.png`), "45" at
  40 mph (`009`), "65" at 43 mph (`068`), "Open" when the road is clear (`285`). The warning state, "faster than you can
  see", is `.ro-sight.short` and `.sight-tag.short` (`web/index.html:453`, `:487`): the same red on the border and the
  plate. So the one warning on the drive screen changes nothing a driver can tell from the normal state except an
  area of the same hue, and for the one in twelve men with a red-green deficiency the red on this paper is olive, like
  the ink. No frame in the twenty-minute replay shows the short state at all, which is how a warning nobody designed
  gets shipped. On the car the sight plate is a white rectangle, a number and "MPH" (`car/007`: "20 MPH" with the eye),
  in a glance the shape of a limit sign, next to a car's own limit display. And `contrast.md` still has Roadbook day
  "MPH", "BRAKE" and ".5" at 4.22:1 (`--face-dim` #736A5A on #EDE4D3), flagged in Review 5 and in round 1, each time
  "left for the next review".
- **Build.** The Sight value is panel ink (not `--signal`) until over-speed (Review 5's pushback, on the record). The
  over-speed state uses two channels on every surface: the cell and the plate take a 2 px hatched border and a bar
  through the eye glyph, the cell says "SLOW" under the number, and the haptic 'hazard' pattern fires once on entry.
  On the car the plate drops "MPH", keeps the eye and the number on the dark panel colour, so it stops looking like a
  sign. `--face-dim` on Roadbook day becomes #665E51 (about 5.2:1, still pencil). The theme contract gains a rule, a
  warning state changes hue and shape, and `web/theme_contract.js` checks the signal token against the panel at 3:1 as
  a non-text floor. The recording adds one frame with the short state (the replay can force it with a sight of 20 at
  40 mph), so the next pack can prove it.
- **Cost.** S.
- **Done looks like.** Converted to greyscale, the over-speed frame still differs from the open one; `contrast.md` has
  no Roadbook row under 4.5:1; the car plate reads as the eye, not a sign.

### IN-4: The status row is one line again

- **Why.** Since round 1's "about 30 min left" and the Undo, the status row wraps: "Rec 1.13 mi · / about 30 min left ·
  / 11:21 PM" on three lines beside Report (`guided-drive/phone/009`), "Rec 9.91 mi · / 15 min left · 11:22 PM / Drive
  ended." on three while the Rec dot is still red and "15 min left" still shows under "Drive ended" (`285`), and in
  landscape "Rec 7.48 mi · / · / 19 min left · 11:21 PM" with a dot on a line of its own (`214`). Round 1's recording
  had it on one line ("Rec 1.4 mi · 30 min · 8:11"). A status row is read in a glance or not at all; three lines of
  17 px with a stray dot is a paragraph in the place a driver's eye lands after the speed. Small, but it is a
  regression on the drive screen, which is the one place I don't accept them.
- **Build.** `web/cockpit.js` around `:5339`: the row holds at most three parts, distance, time left and arrival, with
  "about" dropped once the forecast settles and the time left shortened to "30 min" when the row would wrap (measure
  with `scrollWidth`, as `fitHead` does for the strip); a stray separator never starts a line. While the Undo window
  runs, the row is "Drive ended · Undo in 5" and nothing else: no Rec dot, no time left. Landscape gets the same rule.
  A smoke check pins one line at 390 and 320 pt and in landscape.
- **Cost.** S.
- **Done looks like.** Every drive frame has the status row on one line; `285`'s row says only that the drive ended
  and how long to undo it.

## Did round 1 land?

I-3 and I-4 landed and the pack proves both (`phone/285`, `car/007`, `car/044`). The car's "End again ends now" is the
opposite semantics from the phone's second tap (Undo); defensible on a head unit with one alert, but it should be in
the call sheet as a decision, not an accident. I-1 was disputed and is now measured: half built, cap at 1.6. I-5 and
I-6 did not move, and `contrast.md`'s Roadbook day row is a third-round carry.

## What I'd protect

1. **The voice leads and the screen follows.** The new grammar kept the lead times and the quiet line; "careful" came
   seven times in twenty minutes on a road that earned it, never as decoration. No feature should compete for the
   driver's ears.
2. **The cockpit that does not scale, and the Undo that is not a dialog.** `dynamic-type/phone/003` identical to
   `tabs/phone/003` is correct; IN-2 adds a second designed size beside it, it does not scale this one. And End as a
   five-second Undo in the status row, not a modal, is the right pattern while moving; keep it that way on both
   surfaces.
