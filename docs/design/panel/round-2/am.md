# AM: Amara Diallo, blind since birth, navigates from the passenger seat with VoiceOver

Method. I can't see the photos, so I read what VoiceOver would meet in `web/index.html`, `web/cockpit.js` and `web/instruments.js`. The photos told me which screens exist (guided-drive phone 017-landscape-corner, 034-home-quiet-line, and the flow lists in `r7/INDEX.md`). I have not run VoiceOver on a device: where I say "VoiceOver will", that is read from the code. Unknown stays unknown.

## 1. First impressions

I hold the phone while my partner drives. The question is simple: can I be her co-driver, with the phone reading me the road? Vetta's whole pitch is a co-driver, and the co-driver talks to the driver, not to me.

Credit first: somebody did care. There are 89 aria attributes in the page, real `role="switch"`, `radiogroup`, `slider` for the replay scrubber, `role="dialog"` with `aria-modal`, an `announcer` live region, a `role="status"` on the hazard plate, and the Tapedeck speed readout is a labelled image. That is more than most map apps. The bones are decent.

But three big things break it for me.

1. **The closed Menu is still in my swipe order.** `.sheet` is hidden only by `transform: translateX(105%)` (index.html:881). No `visibility`, no `inert`, no `aria-hidden`. So with the map showing, VoiceOver walks past the plan bar and straight into the whole Garage: every setting, every switch, dozens of stops, before the tab bar. When the sheet is open, the map, the notes strip and the Recenter key stay reachable behind it. I would think the app was broken.
2. **The road book is invisible to me.** `#notes` (index.html:1141) is a bare div. No role, no label, no live region. `renderNotes` rebuilds it on frames, so even a swipe onto it would lose focus. The tulip SVGs have no label. The next-corner cells say only a code ("EASY L"). The one thing the app is for, the next corner and how far, is silent in the accessibility tree.
3. **The Roadbook speed dial has no name.** Only Tapedeck's `sevenSeg` sets `role="img"` and an aria-label (instruments.js:460). The default `speedDial` and the Brake/Bank ball are bare SVG. Binnacle readouts are `<b>30</b><span>Sight</span>` (value, then label), so I'd hear "30, Sight" with no unit and no meaning, and "--" for a missing limit.

Smaller: dialogs (Report, the End card) become `display:flex` but focus never moves into them (only the welcome and the permission sheet call `.focus()`), so I'm left on the key I pressed, behind a modal. The tab bar marks the current tab only with a class; there is no `aria-current`.

## 2. Proposals

### AM-1: Close the doors that are shut (the Menu, and everything behind a modal)
**Why.** Section 1, point 1. It is the single thing that makes the app unusable, and it is a few lines. Evidence: `.sheet` (index.html:881) and `showView` (cockpit.js:3204) toggle only a class; `.overlay` is fine (`display:none`), but nothing makes the page behind it inert.
**Build.**
- Give `.sheet:not(.open)` `visibility: hidden`, with the same 0.2 s delayed-transition trick `.garage-pop` already uses (index.html:798).
- In `showView`, set `inert` on `#notes`, `.stage` and the binnacle while a sheet is open, and on `#app` while any `.overlay.show` or the permission sheet is up (`inert` on everything but the dialog).
- When a dialog opens (`hzOverlay`, `endCard`, `pinOverlay`, `hlOverlay`), move focus to its first control or heading (`tabindex=-1`), and return focus to the opener on close. `Escape` and the two-finger scrub already exist; make VoiceOver's Escape gesture close via a `keydown`-independent handler where the dialog has Cancel/Done.
- Tab bar: `aria-current="page"` on the active tab.
**Cost.** S.
**Done looks like.** With the map up, swiping right from the Where-to field reaches Route/Recenter, the readouts, and the tab bar in under ten stops. Open Garage: only the Garage is reachable. Open Report: focus lands on it, and nothing behind it is.

### AM-2: The road book, said (a real accessible name for the strip, and the hazard plate)
**Why.** Section 1, point 2. The call the driver hears ("Careful, hairpin left, long", guided-drive transcript 02:29) is not what the page exposes to me. I'm the person who could use it.
**Build.**
- `#notes`: `role="group"`, `aria-label="Road book"`, and one hidden-from-sight-but-readable summary line inside it (`sr-only`): the lead call in the grammar's own words plus distance and unit, "Hairpin left, careful, long, in 50 feet; then easy left in 1.3 miles". Build it from the same `n.call`/`n.mods`/`dist`/`unit` the cells use, not a second grammar. Mark the visible boxes and tulip SVGs `aria-hidden`.
- Update the summary only when the lead note changes or crosses a distance band, not every frame, and don't rebuild the node whose text did not change (the strip's per-frame rebuild is what kills focus).
- Do not make it `aria-live` while driving (it would talk over the co-driver); a tap-to-read button is the pattern: the strip is one focusable element, VoiceOver reads it on demand.
- Hazard plate keeps `aria-live="assertive"`; check it doesn't repeat each frame.
**Cost.** M.
**Done looks like.** Swipe to the road book and hear the next corner, its distance and the one after. It reads once per change, never a stream.

### AM-3: Name every instrument, value first
**Why.** Section 1, point 3. The cluster is the part I check for her ("how fast are we going, what's the limit").
**Build.**
- Roadbook `speedDial`: `role="img"` with a live `aria-label` of "21 miles per hour" (reuse the Tapedeck `setA` line at instruments.js:460), updated at most once a second. The same for the g-ball ("Brake, bank 0 degrees"), the odometer ("Trip 1.5 miles of 6.2"), and `dnaBars` ("Tech 62 of 100").
- Readout cells: one `role="group"` with `aria-label` "Speed limit 45 miles per hour" / "Speed limit unknown", "Sight, 30 miles per hour" / "Sight, open". Say the label first and spell the unit; the `--` text stays visual, the accessible text says "unknown".
- Give Sight a one-line accessible description ("the speed you could stop within what you can see") as `aria-describedby`; it is jargon (round 1 left P-3 unbuilt).
- `#map` gets `role="application"`-free treatment: `aria-hidden` while driving (it is a canvas I cannot read), with the road book as its proxy.
**Cost.** S.
**Done looks like.** Every number on the drive screen is spoken with its name and unit, and "unknown" is said as unknown.

### AM-4: A passenger mode that talks to me, not the driver
**Why.** Nothing in the app (and nothing in `ApexNavApp.swift`: no `isVoiceOverRunning`) knows a VoiceOver user exists. The co-driver's speech goes to the speaker for the driver; as the navigator I need the next turn and the pace note on request, and I need to change the route without her stopping the car. That is the product, and sighted passengers want it too.
**Build.** A "Passenger" switch in Garage (default off; offered once, quietly, if `UIAccessibility.isVoiceOverRunning` is true at first drive start). When on:
- Co-driver calls are mirrored to the `announcer` live region at low priority, so VoiceOver queues them after what I'm doing (Apple's `UIAccessibility.post(.announcement)` from the shell, off the web view).
- A single large "What's next?" key reads the strip summary (AM-2) plus time left and arrival. The shake/triple-tap is not needed.
- End and Report get the usual confirm so a stray double-tap can't end her drive (round 1's Undo covers End already; keep it).
- Not required: sound design (can't test here; no audio in the recording).
**Cost.** M.
**Done looks like.** I can sit in the right seat, put on a screen reader, and relay "left in fifty feet, hairpin" without looking at her screen.

## 3. Did round 1 land?
Partly for me. The grammar and the One notation made the spoken lines cleaner and shorter (transcript: "Careful, tight right", "Hairpin left, long"), which helps a listener, but none of it reached the accessibility tree: the strip still has no name, and the Done-key fix (replay's "Done: close the replay") is a real labelled button, good. Dynamic Type was deferred and I can't judge it.

## 4. What I'd protect
- **The labelled controls and roles** (switches, radiogroups, the scrubber slider, dialogs with `aria-modal`): do not regress when AM-1 adds `inert`.
- **Calls in plain words with the warning first** ("Careful, hairpin left"): it is the one grammar I can hear and trust.
