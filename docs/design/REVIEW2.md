# Vetta: second design review

Reviewer: senior product design (mobile, automotive HMI, games UI).
Evidence: the 234 captures in `screens-v2/` and the full set in the capture folder (39 screens on 15pro, 15promax, mini, se,
15pro-land, mini-land; hardware drawn on top, map tiles blocked, stub data), `BRIEF.md`, `REVIEW.md` and its twelve mockups
in `png/`, the 2026-10-29 entries of `docs/CALL_SHEET.md`, `docs/IDEAS.md`, `LiveActivity/ApexLiveWidget.swift`, and the
CSS in `web/index.html`, `web/controls.css`, `web/legal.css`, `web/analysis.html`.

Pixel positions below are CSS points on the named device. The captures are 2x; I measured on the originals.

## Verdict

The redesign landed. Upright on an iPhone 15 Pro the app now reads as one product: the notes-strip lockup, the hazard plate,
the drive-ended card, the theme picker, the crew cover and crest, the stamps and slide switches, red destructive text behind
a confirm sheet. Those were the eight root causes of REVIEW.md 1.1 and six of them are fixed on the main screens.

Two things are not finished. First, the owner is right about the hardware: upright on a 15 Pro is clean, but on its side
and on a 375 pt phone the layout breaks in 19 places (buttons under the home indicator, a tab rail inside the rounded
corner, panels drawn under other panels, a binnacle that overprints itself in Tapedeck, legal pages that start 0 pt
below the island). The e2e check passes because it tests nine screens on one device and asks only "is a control inside the
inset"; most of these faults are overlaps, clipping and zero gaps, which it does not measure. Second, the second tier of
screens (Log, drive detail, the old crew list under the crew page, Stages, the legal pages, the photo viewer) is still the
settings app wearing the road-book costume: native selects, a native file picker with a blue slider, bordered empty-state
paragraphs, a "Crews near you" list of boxes. A new user who only drives will not meet most of these; a crew member meets
them within a minute.

Priority: the safe-area table first (one PR of CSS, half a day), then the second-tier screens.

---

## 1. Safe areas and the Dynamic Island

Every row is a thing I saw in the capture, not an inference from the inset numbers. "Fix" is the change I would make, with
the selector it lives in. Severity: A = wrong on a real phone (clipped, overlapped, unreachable), B = touching or crowded,
C = tidy-up.

| # | Screenshot(s) | What is wrong | Fix |
|---|---|---|---|
| 1 (A) | `15pro-land--01-onboarding.jpg`, `mini-land--01-onboarding.jpg` | "Watch a replay" sits on the home indicator (its underline is the bar). The Start key is drawn over the notes-strip preview: the strip's bottom rule runs behind the key and the "200 ft CREST" plate's bottom edge is cut by it. The overlay (`#onboard.overlay`) is taller than 393 pt and its children are centred, so the ends spill. | In `@media (orientation: landscape) and (max-height: 540px)`: `#onboard { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: center; padding-bottom: calc(16px + var(--safe-bottom)); }` with logo + tagline in column 1 and the strip preview, Start and the link in column 2. Give the strip preview `flex: none; margin: 0 0 16px` and the link `margin-top: 12px`. Upright is fine. |
| 2 (A) | `15pro-land--02-map-idle.jpg`, `15pro-land--03`, `04`, `05`, `06`, `07`, `08`, `19`, `20`, `21`, `22` (rail), `24`, `25`, `26`, `30`; the same on `mini-land--*` | The landscape tab rail starts at the top edge of the display. The active tab's red mark (`.tabbar a.on::before`, `top: -1px`) is at y = 0 and the Map glyph is at y = 15 pt, inside the 55 pt corner radius of the top-right corner. On the device the mark is under the mask and the glyph's top-right is clipped. | In the landscape block: `#app.sheet-open .tabbar, #app.idle .tabbar { padding-top: 28px; align-content: start; }`. Move the active mark to the rail's inner edge in rail form: `.tabbar a.on::before { top: 20%; bottom: 20%; left: 0; width: 2px; height: auto; right: auto; }`. Add the rail to the safe-area e2e check with a corner-radius test (55 pt on 15 Pro, 47 pt on mini). |
| 3 (A) | `15pro-land--09-permission-sheet.jpg`, `15pro-land--18-what-s-new.jpg`, `mini-land--09`, `mini-land--18` | A modal sheet covers the map but the tab rail is still drawn, undimmed, at top-right, and only its clipped "Map" tab shows under the corner. The sheet is inside the `.stage` column, so it never covers the rail. | Make `#permSheet` and the what's-new sheet true overlays: `position: fixed; inset: 0; z-index: 45` (above `.tabbar`), or hide the rail while any overlay shows: `#app:has(.overlay.show, .show#permSheet) .tabbar { visibility: hidden; }`. |
| 4 (A) | `15pro-land--12-hazard-report.jpg`, `mini-land--12-hazard-report.jpg` | "Cancel" is on the home indicator on 15pro-land (text baseline 2 pt above the bar) and cut off below it on mini-land. The report card is taller than 393 pt; `.overlay .card-sheet` pads the bottom but the card is centred, so the padding is what gets clipped. | In landscape: `#hzOverlay .card-sheet { max-height: 100dvh; overflow-y: auto; }` and lay the six plates three across: `#hzOverlay .hz-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } #hzOverlay .hz-grid button { min-height: 56px; }`. Then the card is 300 pt tall and Cancel sits 24 pt above the bar. Upright is correct. |
| 5 (A) | `15pro-land--16-drive-ended-card.jpg`, `mini-land--16-drive-ended-card.jpg` | Share card and Mark a stage are cut at the bottom edge with the home indicator across them; Open in the Log and Done are off-screen. | In landscape: `#endCard .end-card { display: grid; grid-template-columns: 1.2fr 1fr; column-gap: 24px; }` with name, meta and score left and the sentence, the two keys and the two links right; `.overlay .card-sheet { max-height: 100dvh; overflow-y: auto; }`. |
| 6 (A) | `15pro-land--14-replay-Tapedeck.jpg`, `mini-land--14-replay-Tapedeck.jpg` | Tapedeck's binnacle overprints itself on its side: the SURFACE bar meter is drawn over the Sight box, the BRAKE / TURN meter over "TRIP MI OF 35.6", and SCORE over "ROAD: TOWN". `.cluster-dials` in landscape is `var(--dial) 1fr var(--dial)` with `--dial` 76 to 96 px; the `.vfd-bars` renderer has a fixed width wider than that and is not clipped. | In the landscape block: `html[data-theme="tapedeck"] .cluster-dials { grid-template-columns: var(--dial) minmax(0, 1fr); grid-template-areas: "dial read" "bars bars"; }` and `.vfd-bars { width: 100%; min-width: 0; grid-area: bars; }`. Billet and Roadbook fit because their meters are circles sized to `--dial`. |
| 7 (A) | `15pro-land--13`, `14`, `15`; `mini-land--13`, `14`, `15` (replay, three themes) | The tab bar inside the instruments column scrolls away: on 15pro-land its icons are cut by the bottom edge, on mini-land it is gone (the Kit panel runs to the edge). `.binnacle` is `overflow-y: auto` and the bar is its last child. | Take the bar out of the scroller in landscape: `#app { grid-template-areas: "notes notes" "stage binnacle" "stage tabs"; } .tabbar { grid-area: tabs; padding-bottom: var(--safe-bottom); }`, or `.binnacle .tabbar { position: sticky; bottom: 0; background: var(--panel); }`. The live drive hides the bar (`#app.live .tabbar { display: none }`), so only replay shows this. |
| 8 (A) | `15pro-land--04-layers-open.jpg`, `mini-land--04-layers-open.jpg` | The Layers panel opens under the floating loop plate: "Cameras" reads "ameras", "Twisty roads" is half covered. `.edge` is `z-index: 4`, `#app.idle .loop-suggest` is `z-index: 6`. | `#app.idle:has(.edge.open) .loop-suggest { display: none; }` (the plate is an invitation; the panel is a task), or `.edge { z-index: 7 }`. |
| 9 (A) | `15pro--04-layers-open.jpg`, `15promax--04`, `mini--04`, `se--04` | Upright, the panel runs under the plan deck (`.plan` z-index 5): "Co-driver", Notes and Voice are cut at the deck's top rule, and on the SE the panel ends at 3D terrain with nothing to say more is below. The panel is anchored at `top: 38%` and grows down. | Anchor it above the deck and let it scroll: `.edge { top: auto; bottom: calc(var(--plan-bar, 62px) + var(--safe-bottom) + 12px); } .edge-panel { max-height: calc(100dvh - var(--safe-top) - var(--plan-bar, 62px) - var(--safe-bottom) - 88px); overflow-y: auto; }`. Keep the key where it is; the panel grows upward from the key. |
| 10 (A) | `15pro--29-photo-viewer.jpg` and all five others | The photo viewer is not a viewer: the picture and its Make cover / Remove / Done bar are drawn mid-page over the car card and over the "Photos lose their location data" line; the Garage header stays; on its side the tab rail collapses to a lone "Map". `.overlay.dim.photo-view` is appended inside a transformed ancestor, so `position: fixed` is relative to the sheet, not the screen. | In `web/photos.js` append the viewer to `document.body`. CSS: `.photo-view { position: fixed; inset: 0; z-index: 70; background: #000; display: grid; grid-template-rows: 1fr auto; padding: var(--safe-top) var(--safe-right) calc(16px + var(--safe-bottom)) var(--safe-left); } .photo-view .photo-full { max-height: 100%; object-fit: contain; }`. The action bar is the last row, white text on black, Done bold. Tap outside closes. |
| 11 (A) | `15pro--36-privacy.jpg`, `15pro--37-terms.jpg`, `15promax--36`, `37`, `mini--36`, `37` | The draft banner's top edge is 0 to 2 pt below the Dynamic Island. `legal.css` has `main { padding-top: max(24px, env(safe-area-inset-top)) }`, which on a 15 Pro is exactly the 59 pt inset, so content starts at the island's bottom edge. | `main { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }`. Same file, same line, for the licences page. |
| 12 (A) | `15pro--35-about.jpg`, `15promax--35`, `mini--35`, `se--35`, `15pro-land--35`, `mini-land--35` | `about.html` pads only the top. Upright, the hero screenshot runs under the home indicator; on its side "Open the app in your browser" and "Watch a replay" sit on the bar. | `about.html` line 14: `main { padding-bottom: calc(32px + env(safe-area-inset-bottom, 0px)); }`. See also row 36 of section 2: this page should not be opened inside the app at all. |
| 13 (A) | `mini--01-onboarding.jpg`, `se--01-onboarding.jpg` | On a 375 pt phone the hazard plate in the strip preview wraps "CREST" to "CRES / T". The call column has no `min-width: 0` and the next-call box takes its 46 px tulip before the call shrinks. | `.rb-box.now.hz .rb-call b { white-space: nowrap; }` and let the next box give way first: `.notes .rb-box.next { flex: 0 1 auto; min-width: 0; }` with its call `text-overflow: ellipsis`. The theme contract's 21 px floor still holds at 375 pt if the next box truncates. |
| 14 (A) | `15pro-land--05-plan-sheet.jpg`, `mini-land--05`, `15pro-land--06-plan-sheet-More.jpg`, `mini-land--06` | On its side the sheet shows one row of content between the search line and the sticky Find a loop bar; the loop dial's arc pokes out from under the bar (mini-land--05), stamp outlines are drawn under it (15pro-land--06), and on mini-land--06 the Avoid row renders BELOW the bar, between it and the home indicator (the bar is sticky inside a scroller whose padding exceeds the viewport). | Landscape plan sheet as two columns: `.plan.open .plan-body { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; }` (search, recents, loop dial left; Roads, More right) and `.find-bar` as the right column's footer (`grid-column: 2; position: sticky; bottom: 0`). Set `.plan.open { height: calc(100% - var(--safe-bottom)); }` so the scroller's end is the bar, not below it. |
| 15 (A) | `se--05-plan-sheet.jpg`, `se--06`, `se--07-route-card.jpg`, `mini--05`, `mini--06`, `15pro--06` | The sheet's body does not reserve room for the sticky bar: the "More: avoid, corner mix…" row is half under Find a loop (se--05, mini--05), the Corner mix slider is cut (se--06), "CREW FAVOURITES" peeks under the bar (mini--06), a stray stamp outline shows under it on 15pro--06, and "Pin place" is half under the tab bar on se--07. | `.plan.open .plan-body { padding-bottom: calc(72px + var(--safe-bottom)); scroll-padding-bottom: 72px; }` (72 px is the bar) and a paper fade so cut content reads as "more below", not broken: `.find-bar::before { content: ""; position: absolute; left: 0; right: 0; top: -16px; height: 16px; background: linear-gradient(transparent, var(--panel)); }`. The route card's links row gets `padding-bottom: 16px`. |
| 16 (B) | `15pro--08-route-card-scrolled.jpg`, `se--08`, `15pro-land--08`, `15pro--21-crew-page-scrolled-to-chat.jpg`, `15pro--25-garage-theme-picker.jpg`, `15pro--26-garage-bottom.jpg` | Content scrolls under a sticky header with no mask: on se--08 the stat numbers are gone and "DISTANCE TIME CORNERS" hang alone; on 15pro-land--08 "Road feel after first drive" is half hidden; on 15pro--21 "Spots near you" is cut by the "Crew" title; on 15pro--25 and 26 a sliver of a switch shows under "Garage". | `.sheet header { position: sticky; top: 0; background: var(--panel); z-index: 2; }` plus the same 16 px fade below it (`header::after`). In the route card make only the name row sticky and let the stats scroll as one block with the dials. |
| 17 (B) | `15pro--10-driving-Roadbook.jpg`, `15pro--11-driving-night.jpg`, `15promax--10`, `11`, `mini--10`, `11` | The strip's idle line "Clear  No route planned" starts 4 pt from the left display edge; everything else on the screen keeps a 10 to 16 pt gutter. On a real phone the "C" touches the glass bezel. | Give the no-route line the strip's padding: `.notes .note-quiet { padding-left: 16px; }` (the line `web/instruments.js` draws when there is no call), and raise the strip's gutter to the deck's: `.notes { padding-left: calc(16px + var(--safe-left)); padding-right: calc(16px + var(--safe-right)); }` (upright `--safe-left` is 0). The replay strip's "50 FT" at 10 pt would move to 16 pt with it. |
| 18 (B) | `mini--16-drive-ended-card.jpg`, `se--16`, `se--12-hazard-report.jpg`, `se--18-what-s-new.jpg` | The Layers key pokes above a bottom card's top edge (a 6 to 12 pt sliver of its border and bevel). `.edge` is hidden for `.plan-open` and `.sheet-open` but not for overlays. | `#app:has(.overlay.show) .edge, #app:has(#permSheet.show) .edge { display: none; }`. |
| 19 (B) | `15pro-land--27-garage-confirm-sheet.jpg`, `mini-land--27` | The confirm box runs to the bottom edge of the display and the home indicator crosses its padding (the buttons clear it by 22 pt, so this is tight, not broken). On its side a bottom sheet 480 px wide centred in an 852 pt screen reads as a dialog anyway. | In landscape: `.confirm-sheet { align-items: center; } .confirm-sheet .cs-box { border: 1.5px solid var(--panel-ink); margin: 0 0 16px; padding-bottom: 20px; }`. Upright stays a bottom sheet. |
| 20 (C) | `15pro--02-map-idle.jpg` and every upright map screen | The Layers key's right border is 10 pt from the display edge (`.edge { right: 0 } .map-key { margin-right: 10px }`); the deck and plates use 16 pt. It does not touch the corner (it sits at 38 % height) but it looks pushed against the glass. | `.map-key { margin-right: 16px; }`. The mockup (`01-cockpit-idle.html`) keeps the keys 16 pt in. |
| 21 (C) | `15pro-land--13-replay-Roadbook.jpg`, `15pro-land--14`, `15` | The hazard plate's left edge is 48 pt from the display edge and 11 pt right of the island's edge. Legal, and the island is at mid-height so they never overlap, but on a real phone the plate looks tucked against the sensor. | `.hz-plate, .plates, .place-plate { left: calc(16px + var(--safe-left)); }` in the landscape block (the safe inset is 59 pt; 16 pt more clears the island's own margin). |
| 22 (C) | `mini-land--10-driving-Roadbook.jpg`, `mini-land--11` | "Finding GPS…" wraps to two lines in the 320 px instrument column; Report and End stay on one line so the row grows. | `.drivebar .status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }`. |

What to add to the e2e flow (`e2e/smoke.js`, "safe areas"): mini (375 x 812, 47 pt corners, 44 pt notch band) and SE
(375 x 667, no insets) as devices; the 11 screens above that it does not open (onboarding, Layers open, drive-ended,
what's new, photo viewer, crew page, theme picker, Tapedeck and Billet replay, privacy, about, the ETA page); a corner
test (any control whose box intersects the quarter-circle of radius 55 pt in a corner fails); an overlap test (no two
visible, interactive boxes intersect); and a gap test (text at least 8 pt from any display edge, 12 pt from the island).

### The Live Activity (`LiveActivity/ApexLiveWidget.swift`)

Judged against the Human Interface Guidelines for Live Activities and the Dynamic Island's four presentations.

| Presentation | What is wrong | Fix |
|---|---|---|
| Compact trailing | `Text(context.state.note)` in `caption2` with `minimumScaleFactor(0.6)` in a 52 pt frame. A real call ("RIGHT 1 PLUS OFF-CAMBER") is 22 characters; at 60 % of 11 pt it is 6.6 pt type and still truncates. The HIG wants the compact pair to be glanceable: a glyph or one short value each side of the sensor, never a sentence. | Send a short form in the state (`noteShort`, e.g. "R1+", "L3-", "CREST", "GRAVEL") and show it `caption2.bold()` with `lineLimit(1)` and no scale factor; put the tulip (a 14 pt `Image`) before it. Keep the full note for the lock screen and the expanded bottom row. |
| Compact leading | Distance in `caption2.bold().monospacedDigit()` with `minimumScaleFactor(0.6)` in 52 pt. "300 ft" fits; "1,200 ft" or "0.4 mi" scales. Fine, but the two sides compete for width when both scale. | Drop the unit in compact ("300", "0.4mi" only when over 1,000 ft) and remove the scale factor. |
| Minimal | Distance as text (`caption2`, scale to 0.5). The minimal view is a circle about 36 pt across shown when another activity has the island; 11 pt digits scaled to 5.5 pt are unreadable and look like a smudge. | A glyph: the next tulip (or the orange hazard triangle when a hazard is next), 16 pt, no text. |
| Expanded leading / trailing | Distance `title3.bold()` with `padding(.leading, 4)` and the ETA `caption` with `padding(.trailing, 4)`. The leading and trailing regions curve around the sensor; 4 pt is below Apple's own margin and the first digit sits against the island's inner radius. `belowIfTooWide` is right. | `padding(.leading, 10)` / `padding(.trailing, 10)`, and give the trailing region the ETA on one line without the split on "·" (send `etaShort` from the page instead of parsing). |
| Expanded bottom | Note `headline`, `lineLimit(1)`, `minimumScaleFactor(0.7)`; title `caption`. Correct region for the long text. Long calls shrink rather than wrap; the contract says calls take another line, not a smaller size. | `lineLimit(2)` and no scale factor; the expanded view may be up to 160 pt tall. |
| Hazard | No hazard presentation. The contract (REVIEW.md 4.3.1) says the hazard plate looks the same everywhere; on the lock screen and in the island a hazard call is indistinguishable from a corner. `keylineTint(.red)` paints the island's outline the record colour. | Add `isHazard: Bool` to `ContentState`; when true, `keylineTint(Color(red: 1, green: 0.48, blue: 0.10))` (the signal orange), prefix the note with `Image(systemName: "exclamationmark.triangle.fill")` in orange, and in compact show the triangle in the leading slot. Otherwise keyline in the panel ink, not red. |
| Lock screen banner | `title3.bold()` note on two lines, distance `title2.bold()`, 16 pt padding, black at 85 %. Fine. The title (route name) under the note is `caption` secondary and gets lost; the ETA under the distance too. | Fine as is. Consider `.activityBackgroundTint(Color(white: 0.09))` so the banner matches the Roadbook night panel rather than pure black. |

The `ApexQuickWidget` and the Control Center button were not in the capture set and are not reviewed here.

---

## 2. Screen by screen

Same shape as REVIEW.md 1.2. Capture names are `<device>--<nn-screen>.jpg`; the 15pro one is given unless another shows
the fault better.

| Screen | Capture | What is wrong | What it should be |
|---|---|---|---|
| Onboarding | `15pro--01-onboarding.jpg` | Better than day-01: one Start key, the strip preview with a hazard plate sells the product. The preview is a static strip, not the 10-second silent loop the review asked for. The Start key is a plain ink bar, not the red record key the rest of the app uses for Start. The tagline block floats in the top half with 180 pt of empty paper above it. | Keep. Make Start the red record key (`.btn-start` style with the dot) so the first key the user sees is the one they will use. Cycle the preview through three calls every 3 s (CSS keyframes, honours reduced motion). Landscape per section 1 row 1. |
| Map idle | `15pro--02-map-idle.jpg` | Close to `01-cockpit-idle`: deck, red Start, the suggested loop as a tulip in the one box, Layers key. Missing from the mockup: the place plate (place, weather, temperature) top-left, and the Recenter key is hidden until the map moves (shown in `03`). With tiles blocked the screen is paper, which is expected. | Show the place plate when a fix exists ("Tellico Plains · Dry · 61°"); the mockup's quiet sense of place is the only warmth on an idle screen. Keys 16 pt in (row 20). |
| Map keys | `15pro--03-map-Recenter-and-Layers-keys.jpg` | Recenter as a second key with the countdown in the glyph's place: good, matches the call sheet. "5s" is a number in a box; the crosshair is gone while it counts. | Keep the crosshair and put the seconds as a thin arc around the key's edge (a 48 px SVG ring that empties), so the key keeps its shape. |
| Layers open | `15pro--04-layers-open.jpg`, `15pro-land--04` | Panel content is right (map things first, co-driver below a rule, Who sees me as a link). It is drawn under the deck and under the loop plate (rows 8, 9). The switches are 36 x 20 px with a 14 px square thumb: they read as checkboxes, not the slide switch with travel from REVIEW.md 2.1. | Fix the z-order and anchoring. Switch: 44 x 24 px track, 20 px thumb that travels 20 px, the on state's track in ink; thumb with a 2 px drop. Same component in Garage (`26`) and Friends (`22`). |
| Plan sheet | `15pro--05-plan-sheet.jpg` | Two controls for one quantity: the 96 px loop dial AND five detent chips (15 mi, 30 mi, 45 mi, 1 h, 2 h). The mockup has one dial with five detents and a value readout. Helper prose ("Turn the dial, then Find a loop. It starts and ends where you are.") explains the control instead of the control explaining itself. "Fun: twistier roads that add up to about a third to the trip" is a second helper line. Recents are missing (stub). | One control: the dial with five detents drawn as ticks and the value in its face; drag or tap a tick. Drop the two helper sentences; keep "back where you started" after the heading. The Roads switch is good. |
| Plan More | `15pro--06-plan-sheet-More.jpg` | Stamps (Avoid) and balance sliders (Corner mix) match the mockup and look like what they do. "Start from" is a grey web input with a swap glyph. Prefer stamps are below the fold under the sticky bar. Presets are not visible in the capture. | Make "Start from" a row like a recent ("From: current location" with the ink pin glyph) and a tap-to-edit, not an outlined input. Fix the sticky bar reservation (row 15). |
| Route card | `15pro--07-route-card.jpg` | Three stamped numbers on a rule and four small dials: the mockup's instrument feel is there. Missing with stub data: the elevation profile with corner ticks and named legs, the facts with glyphs, the alternatives as three tiles. Twist and Flow show "0" with the needle at rest for a route with 0 corners, which is true but reads as broken next to the two "--". "Share ETA" and "GPX" are as prominent as Save. | Capture a routed route with corners so the profile and tiles can be judged (IDEAS U-37 below). Links row in two weights: Save and Share in ink, Share ETA, GPX and Pin place in pencil. |
| Route card scrolled | `se--08-route-card-scrolled.jpg` | Numbers scroll out, labels stay (row 16). On every device the card is shorter than the screen with stub data, so the sticky title has nothing to do. | Row 16. |
| Permissions | `15pro--09-permission-sheet.jpg` | Still the best screen. Landscape rail bug (row 3). | Keep. |
| Driving | `15pro--10-driving-Roadbook.jpg` | Tab bar gone, one status line, Report and End in the row, the g-ball with BANK, the Score slot: the five review asks are met. Remaining: Limit and Sight are two identical outlined boxes (the contract wants Limit as the white US sign); the strip's idle line hugs the edge (row 17); the trip reads "000.0 / Trip mi / Road: --" in three type sizes with "Road:" as a labelled field; "BRAKE" is engraved on the g-ball but the ball reports bank and score. The speed dial is good. | Limit: a 44 x 52 px white sign, black 1.5 px border, "SPEED LIMIT" in 7 px caps, the number in 20 px condensed; Sight stays an outlined box with the red value. Trip: one line, "012.4 mi" in the drum and the road name under it in pencil without the "Road:" label (the name is the label). G-ball engraving: "BANK". |
| Driving night | `15pro--11-driving-night.jpg` | Same layout, night tokens; the map's casings are dimmer as the call sheet says. The numerals are the same size as day. | Night mode (roadmap 11) is still a token swap on the binnacle. Speed numeral 46 px, Limit and Sight on one 36 px row, the trip readout hidden until tapped. |
| Hazard report | `15pro--12-hazard-report.jpg` | Six hazard-style plates: the report looks like what others will see. Right. Landscape (row 4). | Keep. "One tap, no confirm, 3-second undo in the status line" from the review: not visible in the capture, verify it exists. |
| Replay Roadbook | `15pro--13-replay-Roadbook.jpg` | The strip lockup (50 FT, tulip, RIGHT 1 PLUS, OFF-CAMBER · CARE in red, next call) and the Gravel plate are the best things in the set. The replay controls (Pause in red outline, 1X, Video) are a third button language above the binnacle; the elevation thumbnail is a 70 x 30 px unlabelled black blob; the tab bar stays and squeezes the dial to 110 px on 15pro. | Replay controls as one slide switch (Pause / Play) and a small detent for speed; the thumbnail as a scrubber across the full width above the binnacle with the position mark, or dropped. Hide the tab bar during replay as during a drive; the "Replay · Demo · Dry Ridge Rd ×" plate is the exit. |
| Replay Tapedeck | `15pro--14-replay-Tapedeck.jpg` | The VFD look is real: seven-segment speed with ghost segments, teal and amber, bar meters, scanlines, the Kit panel. Faults: Kit is a 14 x 12 blob (the ears and muzzle do not read at 56 px; the mockup drew him at 80 px with a lighter body); "KIT SAYS RIGHT 1 PLUS OFF-CAMBER, CAR…" truncates the one line that should wrap; the Pro-trial banner is a bordered box floating over the map where the hazard plate lives; landscape binnacle overprints (row 6). The replay thumbnail stays Roadbook's black-on-paper. | Kit at 80 px on a 16 x 14 grid with two idle frames and the four lean frames wired to the call's direction (REVIEW.md 4.1); the line wraps to two; the trial banner becomes the status line ("Tapedeck · 9:40 left · Stop"); the thumbnail in VFD teal. |
| Replay Billet | `15pro--15-replay-Billet.jpg` | Brushed panel, knurled bezels, red glow numerals, the g-ball in a bezel: matches the mockup. Bug: the trip drum's tenths digit is a dark red block with no glyph (`.odo.boxed .dg:last-child` is ink-on-panel in Roadbook; Billet's override sets the background and loses the digit's colour). Sight "21" in red glow is right. | `html[data-theme="billet"] .odo.boxed .dg:last-child { color: var(--accent); }`. Everything else keep. |
| Drive ended | `15pro--16-drive-ended-card.jpg` | A full card with DRIVE SAVED, the name, the meta line, the score slot, one sentence, two keys and two links: roadmap 7 done. The "--" placeholder is drawn as two 22 x 8 px filled black bars that read as a redaction; "Open in the Log" left and "Done" right at different baselines. | "--" in the numeral font at the score size (56 px, pencil colour). Links on one baseline, Done right. Landscape (row 5). |
| Crash check | `15pro--17-crash-check.jpg` | Correct priority: I'm OK as the big ink key, Get help under it, the countdown line. The I'm OK key carries a 2 px red focus ring (`:focus-visible` on a programmatic focus) that reads as an error state; the content uses the top 40 % of the screen. | Scope the ring: `:focus-visible:not(:focus-visible[data-auto])` or focus the button with `preventScroll` and `focusVisible: false`, and check on a device whether WebKit draws it after `element.focus()`. Centre the block vertically; make Get help 56 px tall too (a shaken driver taps big things). |
| What's new | `15pro--18-what-s-new.jpg` | Four bold-lead paragraphs and Got it: fine, quiet. Same focus ring on Got it. Landscape rail (row 3). | Keep; fix the ring. |
| Crew page | `15pro--19-crew-page.jpg` | Cover, crest over the stripe, name, motto, meta, Invite: the mockup's top half is built and it is the warmest screen in the app. Faults: the crew switcher (RIDGE RUNNERS / SUNDAY CLUB stamps) sits under a "Crew" title that says nothing; "Plain livery" is a box inside the page with an empty tick-marked meter (an empty gauge for an empty state); "6 members · Public · Tellico Plains, TN" wraps on 15pro; the Next drive card's date tile is cut by the tab bar on 15pro (fine, it scrolls). The board and the chat are below the fold and the capture named "scrolled to chat" (`21`) never reached them. | Drop the "Crew" title; the switcher is the header. Livery line without a box: "Plain livery · Decals come from crew-mates with Vetta Pro" in pencil, no meter until there is a count. Meta line in 13 px so it fits 361 px. |
| Crew Works livery | `15pro--20-crew-page-Works-livery.jpg` | The Works box shows "14 Decals from 5 supporters · Factory at 20", a progress rule and five tilted stickers printed with "3 3 3 3 2". The stickers are the mockup's idea but the numbers on them are counts, so they read as dice. "Your 2 Decals are on Ridge Runners. Take them off" is a centred underlined link in the box. | Stickers carry the supporter's initial (S, J, N…) in the crew's stripe colour, tilted 4 to 8 degrees, with the count in the line above. The "Take them off" link left-aligned in pencil under the stickers. |
| Crew page, lower | `15pro--21-crew-page-scrolled-to-chat.jpg` | This is the old crew list (REVIEW.md 1.2 "Crew member"), still under the page: Routes shared with you, Spots near you with an "All" chip, Crew drives with a boxed "Plan a drive", Crews as two boxed cards, a native `<select>` "Private: invite link only", "New crew name" + Create, Crews near you. Ten sections in identical type, the screen the owner described in the brief. The call sheet says it stays "until those move into the page's own settings". | Move it now: a gear key on the crew page header opens a Crew settings sheet (members, invite links, public/private, leave, create another). Routes shared and Spots become rows on the page ("3 routes shared · 2 spots near you") that open their lists. Plan a drive stays as the Next drive card's empty state ("No drive planned. Plan one." with the key). |
| Friends panel | `15pro--22-crew-friends-panel.jpg` | Matches `12-friends-map` closely: Show me to, Delay, Position shown as, Only while driving, Home zones, one paragraph. The Show friends switch is the 36 x 20 checkbox-style toggle; "None yet: add one in Garage, Privacy" is bold. | Switch component as in Layers. The home zones line in pencil with "Garage, Privacy" as the link. |
| Plan a drive | `15pro--23-crew-plan-a-drive.jpg` | The capture is the crew page, not the form (the tour's tap did not open it, or it opens in the old list below). Cannot review the event form from this set. | Re-capture with the form open; make "Plan a drive" on the Next drive card open the form as a sheet over the page. |
| Garage | `15pro--24-garage.jpg` | "You" with the initial in a bezelled circle, handle and "1,240 points" (points of what? Octane left the UI in phase 1); Add a photo as an outlined key; the EXIF line; the car card with the cover (the stub logo), name, "RED" in quotes, spec line, three gallery thumbnails and keys below the fold. The card is a box with its photo bleeding to the box's edge: good. | Remove "1,240 points" or name it ("1,240 road-data km" if that is what it is). Car colour without quotes, as a small swatch plus the word. |
| Theme picker | `15pro--25-garage-theme-picker.jpg` | Built as the mockup: live preview strip (call + speed), name, In use / PRO + Try it, two lines, the voice line, Hear. The Tapedeck and Billet previews use their own type and glow. The previews are static; "Try it" starts the 10-minute replay (seen in `14`, `15`). | Keep. Animate the preview's speed from 38 to 42 on a 4 s loop so the cards feel live (reduced motion: static). |
| Garage, lower | `15pro--26-garage-bottom.jpg` | Settings as rows with slide switches (Haptics, Key sounds), "Night Off" with the value in red (red is record and destructive elsewhere), "How this works +" disclosures, The words as a switch, Map motion as a three-position switch, Sources and licences "+", Privacy · Terms of use · Licences links. Much better than day-22..25. | Values in ink, not red (`.sheet .row .value { color: var(--panel-ink) }`). Night as a three-position switch (Auto / Day / Night) rather than a value. |
| Confirm sheet | `15pro--27-garage-confirm-sheet.jpg` | Red action text, Cancel as the ink key with a bevel and the focus ring, the sentence above. Correct (REVIEW.md 2.1). | Keep; landscape (row 19); ring as in Crash check. |
| Build thread | `15pro--28-build-thread.jpg` | Car header with the drawing, spec line, owner and followers; the stage bar; the numbered step on a timeline rule; two photos; parts as stamps; "Tested on a drive: Vetta Score 702"; a suggestion with the red rule; the compose bar. This is `10-build-thread` built. The compose bar's input is 160 px wide on 15pro ("Reply, or suggest s" cut) because Suggestion and Post share the row. | Compose bar: input full width on its own line, Suggestion and Post under it right-aligned, or Suggestion as a stamp inside the input's left end. |
| Photo viewer | `15pro--29-photo-viewer.jpg` | Not a viewer (row 10). | Row 10. |
| Friends on the map | `15pro--30-friends-on-the-map.jpg` | Identical to `02`: the stub has no friends, so no pucks, no fuzz circles, no hatched home zone. The mockup's `12-friends-map` cannot be judged. | Stub two friends (one "about 10 min ago · within a mile" with a fuzz circle, one "Driving · Skyway" exact) and a home zone in `tools/app_tour.js`. |
| Log | `15pro--31-log.jpg` | The hero score (as the two black bars again), then four lines of equal weight: "2026 so far…+", "This month: 0 of 3 challenges done +", the one drive row (date tile, name, "--"), "Your week…+". The drive list, which is the Log, is one row among folded summary lines, and "Your week" sits under it. With one drive this is sparse; with forty it will be a long list with the week line lost at the bottom. | Order: hero, one quiet summary row ("2026 · 2 mi · 1 drive · 0 of 3 challenges" that opens the folded lines), then the drive list as the index with a corner sparkline per row (REVIEW.md roadmap 13), Your week as the first row of the list when the week has drives. The "--" in the numeral font. |
| Log, Stages | `15pro--32-log-stages.jpg` | "No stages yet" in a bordered box with two sentences (REVIEW.md 1.1 root cause 7, unchanged); "New stage" as an ink key in the header AND a "New stage from a drive" form below with a native `<select>` (caret, system font), helper prose, a black wedge profile, an input and Save stage. Two ways to start the same thing on an empty screen. | One line, no box: "No stages yet. Mark a stretch you drive often from a drive's page." with the drive list's "Mark a stage" as the action. The form opens from a drive, not from the tab. The select becomes a row list of drives. |
| Drive detail | `15pro--33-drive-detail.jpg` | Score first with the four part bars, meta line, Replay as the ink key with Compare, Share, Share card as links: roadmap 14 done. "Share card" wraps to its own line on 15pro. The trace panel's Speed / Smoothness toggles are two boxes, not a switch. | Links in 14 px so four fit; the trace toggle as the slide switch. |
| Drive detail, lower | `15pro--34-drive-detail-scrolled.jpg` | Tags as stamps and "+ tag" with Add: right. Then "Dashcam overlay" as a bordered box with a native file input ("Choose File  No file chosen", system font, overflowing the box on SE) and a native range slider in iOS blue. This is the most un-Vetta thing in the set and it is on the page the review called the product's best. | "Pick a video" as an ink key that opens the picker (the `<input type=file>` hidden, as `#gpxFile` already is); the offset as the balance slider component from the plan sheet; the box becomes a rule-separated section. |
| About | `15pro--35-about.jpg` | The website's landing page opened inside the app: "Open the app in your browser" and "On iPhone: in TestFlight now, by invitation" shown to someone who is in the app; a red-highlighted headline the app never uses; no way back but the system gesture. | Inside the app, About is a Garage row with the version, "No races", the four promises and the links; the website stays on the web. |
| Privacy, Terms | `15pro--36-privacy.jpg`, `15pro--37-terms.jpg` | `legal.css` pages: white (#f7f6f2) not paper, system font not Inter Tight, an 8 px rounded yellow draft banner, orange links, no Back. Row 11 for the island. | Use the app's tokens (`--panel`, `--panel-ink`, `--rule`, `--accent`) and a "‹ Garage" row like drive detail's "‹ Log". The draft banner as an ink rule with pencil text until the owner approves. |
| Licences | `15pro--38-licences.jpg` | Same page style with an orange "← Back to the Garage" link; the "‹" the app uses elsewhere becomes "←" here. | Same as above; one back glyph everywhere ("‹"). |
| Shared ETA page | `15pro--39-shared-ETA-page.jpg` | "Your driver is about NaN min away", "Arriving around Invalid Date", "Updated NaN min ago": the stub link has no data and the page prints the arithmetic. This page is seen by someone who does not have the app, so it is a first impression. | `web/eta.js`: if the minutes or the time are not finite, show "This link has ended" with the one explanatory sentence; otherwise "--" for a missing value. Never NaN. |

---

## 3. Against the brief and the principles

**Fun but not goofy.** Met on the drive screens and the crew page: the hazard plate, Billet's glow, Tapedeck's segments,
the crest on the stripe. The fun is in the themes and in the few moments the review named, which is where the brief put it.
Kit is the one place it tips toward goofy by accident: a blob with two orange eyes next to "KIT SAYS" is a mascot without a
face. Either draw him properly at 80 px or leave him out until the lean frames exist.

**Bespoke and tactile.** Met where the three shaped controls were used (stamps, slide switches, detents, the record key
with its bevel, the drum). Not met wherever the browser's own control is still on screen: `<select>` in Stages and the
crew list, `<input type=file>` and `<input type=range>` in Dashcam overlay, the grey "From:" input, the checkbox-sized
toggles. These are few, but each one is a crack in the costume and three of them are on the Log, the second most visited
tab.

**Visual design speaks to function.** Mostly met. Three cases where it does not: red is used for a value ("Night Off",
"Notes Full") as well as for record and destructive; the score's "--" is drawn as two filled bars that look like a censor
mark; the Works stickers carry numbers that look like dice.

**Intuitive for a new user.** The first minute (open, Start, permissions, drive, end card) is now the review's 3.1 and it
works without reading. The new user who taps Crew signed out gets the three-glyph promise. The new user who taps Log gets
four folded lines and no drives, which is quiet but not inviting; Stages is still a form.

**Power behind one or two taps.** Met: More on the plan sheet, Layers key, the gear rows in Garage with "How this works".
The exception is the crew: the power (invite links, public/private, members, create) is the old list under the page, at
depth zero and in the way, rather than behind a gear at depth two.

**No emojis.** Met in every capture. Chat rendering was not captured; the review's "strip to text" rule should have a test.

**Where the build improved on the mockups.** The onboarding strip preview with a hazard plate (the mockup had none);
Recenter as a key with a countdown; the drive-ended card's "DRIVE SAVED" label and the one-sentence line; the hazard
report as six plates (the mockup described it, the build did it); the theme picker's Try it with a 10-minute trial; the
build thread's "Tested on a drive: Vetta Score 702" as a stamp line rather than prose; the Layers panel's Who sees me link.

**Where it fell short of the mockups.** The place plate (absent); the loop dial (dial plus chips, plus two helper
sentences); the route card's profile, facts and alternative tiles (not capturable with the stub, so unverified); the Limit
sign (an inverted box); Kit; the Log index; the crew list; night as a token swap; the photo viewer.

**Still sterile or list-like.** The Log tab, Stages, the lower crew page, Garage's "You" block, the legal pages, the
Dashcam section. The empty states still explain in a box (Stages, Crews near you, Spots near you).

**Confusing.** "1,240 points" with no unit; "New stage" twice on one screen; the replay's three-language controls (Pause
outline, 1X box, Video key); the Pro-trial banner in the hazard plate's position; the Layers panel cut by the deck (looks
like the end of the list); "Share card" and "Mark a stage" with no hint which saves (neither, the drive is saved); the
ETA page's NaN.

**Inconsistent between screens.** On its side, the Map, Crew and Garage tabs use a right-hand rail and the Log
(`analysis.html`) uses a bottom bar. Back links: "‹ Log", "‹ Back", "← Back to the Garage", none on Privacy. Backgrounds:
paper in the app, #f7f6f2 in legal pages, the landing page's own in About. The link colour: ink underlined in the app,
orange in legal pages. Fonts: Inter Tight in the app, the system font on legal pages.

**Inconsistent between themes.** Tapedeck's landscape binnacle breaks; Billet's drum loses a digit; the replay
thumbnail stays Roadbook in all three; Tapedeck's "KIT SAYS" truncates where Roadbook's strip wraps. The contract items
that matter (hazard plate, layout, Limit, "--", the record key) hold across all three, which is the important part.

---

## 4. IDEAS.md

### Additions

| id | idea | impact | effort | from |
|---|---|---|---|---|
| U-23 | Safe-area pass on landscape and 375 pt phones: section 1 rows 1 to 22 of REVIEW2.md (onboarding, drive-ended, hazard report and confirm clear the home indicator; tab rail inset from the corner and hidden under overlays; Layers panel anchored above the deck and above the loop plate; legal and about pages padded; notes strip gutter; hazard call nowrap). Extend `e2e/smoke.js` "safe areas" with mini and SE, the eleven missing screens, a corner test, an overlap test and a gap test | H | S | REVIEW2.md §1, owner 2026-10-29 |
| U-24 | Sticky headers and footers never show half-cut content: a 16 px paper fade under every sticky header and above the plan sheet's Find bar; the sheet body reserves the bar's height | M | S | REVIEW2.md §1 rows 15, 16 |
| U-25 | Photo viewer as a full-screen lightbox appended to `body`: black, safe-area padded, the action bar at the bottom, tap outside closes | M | S | REVIEW2.md §1 row 10 |
| U-26 | Legal pages (privacy, terms, licences) and About on the app's tokens: paper, Inter Tight, ink links, a "‹ Garage" row, the draft banner as a rule. About inside the app is a Garage row, not the landing page | M | S | REVIEW2.md §2 |
| U-27 | One landscape chrome: the Log gets the right-hand tab rail the other tabs have; the active mark on the rail's edge; the rail outside the binnacle's scroller so it never scrolls away | M | S | REVIEW2.md §1 rows 2, 7 |
| U-28 | Tapedeck's landscape binnacle: bar meters under the readouts, never over them | H | S | REVIEW2.md §1 row 6 (bug) |
| U-29 | Billet's trip drum tenths digit renders as a blank red block | M | S | REVIEW2.md §2 Replay Billet (bug) |
| U-30 | The old crew list under the crew page becomes a Crew settings sheet behind a gear key (members, invite links, public/private, leave, create); Routes shared and Spots become rows on the page | H | M | REVIEW2.md §2 Crew page lower, REVIEW.md 3.3 |
| U-31 | Plan sheet: one loop control (the dial with five drawn detents and the value in its face), no chips, no helper sentences | M | S | REVIEW2.md §2 Plan sheet, mockup 02 |
| U-32 | Log index: hero, one quiet summary row, then the drive list with a corner-density sparkline per row; Your week as the list's first row | M | M | REVIEW.md roadmap 13, REVIEW2.md §2 Log |
| U-33 | Empty states as one line and one action, never a bordered box (Stages, Crews near you, Spots near you, Routes shared) | M | S | REVIEW.md 1.1 (7), REVIEW2.md §2 |
| U-34 | The score placeholder "--" drawn in the numeral font at the score's size, not as two filled bars (drive-ended card, Log hero, drive detail) | L | S | REVIEW2.md §2 |
| U-35 | Live Activity to the HIG: compact trailing shows the tulip and a short call ("R1+"), minimal shows a glyph only, expanded regions get 10 pt margins and a two-line note, a hazard turns the keyline and triangle signal orange | M | S | REVIEW2.md §1 Live Activity |
| U-36 | Night as a mode on the binnacle: larger speed numeral, Limit and Sight on one row, the trip readout hidden until tapped | M | M | REVIEW.md roadmap 11 remainder |
| U-37 | Capture stubs for every mockup surface in `tools/app_tour.js`: a routed route with corners, profile and alternatives; two friends and a home zone on the map; the Plan a drive form open; the crew board and chat; a Tapedeck drive, not only a replay | M | S | REVIEW2.md §2 (Route card, Friends on the map, Plan a drive) |
| U-38 | Kit redrawn at 80 px on a 16 x 14 grid with two idle frames and the four lean frames wired to the call's direction; the "KIT SAYS" line wraps to two | M | M | REVIEW.md 4.1, REVIEW2.md §3 |
| U-39 | The Pro-trial banner leaves the map (the hazard plate's place) for the status line: "Tapedeck · 9:40 left · Stop" | L | S | REVIEW2.md §2 Replay Tapedeck |
| U-40 | The Limit readout as the white US sign (theme contract 4.3.5): 44 x 52 px, black border, SPEED LIMIT in 7 px caps | M | S | REVIEW.md 4.3 |
| U-41 | "1,240 points" in the Garage header: remove, or name the unit | L | S | REVIEW2.md §2 Garage |
| U-42 | Works stickers carry the supporter's initial in the stripe colour, not a count | L | S | REVIEW2.md §2 Crew Works livery |
| U-43 | Shared ETA page never prints NaN or Invalid Date: "This link has ended", or "--" | M | S | REVIEW2.md §2 (honesty rule) |
| U-44 | The slide switch component: 44 x 24 track, 20 px thumb with travel and a 2 px drop, used in Layers, Garage and Friends in place of the 36 x 20 toggle | M | S | REVIEW.md 2.1, REVIEW2.md §2 Layers |
| U-45 | Replay controls as one slide switch (Pause / Play) and a speed detent; the elevation thumbnail as a full-width scrubber; the tab bar hidden during replay as during a drive | M | S | REVIEW2.md §2 Replay Roadbook |
| U-46 | Chat and names render emoji as text (strip or replace); a test over the crew chat and build replies | L | S | REVIEW.md "Not doing", brief |

### Re-ratings and rewordings

| id | change |
|---|---|
| U-16 | `done` to `partial`: the landscape cockpit exists, but the tab rail sits in the rounded corner, Tapedeck's binnacle overprints, the replay's tab bar scrolls away, and the plan sheet is one row tall (REVIEW2.md §1 rows 2, 6, 7, 14). The remainder is U-23, U-27, U-28. |
| U-11 | `done` to `partial`: the Live Activity ships, but its compact and minimal presentations put a sentence and scaled digits where the HIG wants a glyph, and it has no hazard state (U-35). |
| U-18 | Reword and raise to **H / M**: "Replace the remaining browser controls with the app's own: `<select>` (Stages drive picker, Compare's A/B, the crew list's privacy), `<input type=file>` (Dashcam overlay, Import a drive, Add photo) behind an ink key, `<input type=range>` (Dashcam offset, Corner mix) as the balance slider, the grey text inputs (Start from, New crew name) as rows." Partial today: selects only in Garage. |
| U-05 | Reword: "Audit the cockpit with simulated GPS frames on six phone shapes (15 Pro, 15 Pro Max, 13 mini, SE, and the two landscapes), day and night, with the hardware drawn on top (`tools/app_tour.js`)". Status `partial`: the browser track exists; the six shapes were run once by hand for REVIEW2 and should be a CI artefact. |
| U-07 | Status note: the binnacle now shows the live Score; the remaining gap is sunlight glare on a device (owner phone test). Keep `partial`. |
| U-08 | Keep `partial`; reword the remainder: "Billet's needle overshoot and Tapedeck's segment latch exist; still to do: the route reveal, sheet springs, the theme-picker preview loop, the dial sweep on drive start". |
| U-13 | Keep `partial`; add "the friends layer and measured roads are now Layers-key switches, so the surface layer belongs there too". |
| U-15 | Keep `H / M partial`; add "the Garage and crew page are new since the last pass and were not checked; the theme picker's Hear keys need labels". |
| U-19 | Fill the empty status cell: `done` (the row says what shipped) with the nickname gap as `todo`. |
| S-10 | Status: "done on the server; the Look shop was removed from the app in design phase 1 (REVIEW.md roadmap 8). Octane is not shown anywhere a user reads; the Garage's '1,240 points' is the last trace (U-41)". |
| O-04 | Keep `partial`; add "the onboarding strip preview is static (REVIEW.md 1.2 Onboarding 1 asked for a 10 s loop)". |
| O-01 | Keep `done`; add "landscape layout broken (U-23 row 1)". |
| C-07 | Keep `done`; add "the hazard report's six plates are 60 pt; the replay controls (1X, Video) and the Layers switches are under 44 pt and should not be reachable while moving, or should grow". |
| Z-07 | Add: "the in-app pages are drafts in a different visual system; U-26 restyles them without changing the words". |

---

## 5. Roadmap 2

Each item is one PR. The first five are the safe-area fixes the owner asked for; they are CSS only and can ship together
if one person does them in a day, but they are listed separately so each can be checked on a phone.

1. **Landscape overlays clear the home indicator.** `#onboard` two-column layout; `#hzOverlay` three-across with
   `max-height: 100dvh; overflow-y: auto`; `.end-card` two-column; `.confirm-sheet` centred with a 16 px bottom margin in
   landscape. (§1 rows 1, 4, 5, 19.)
2. **The tab rail and the corners.** `padding-top: 28px` on the landscape rail; the active mark on the rail's inner edge;
   the rail hidden under `#permSheet`, what's new and every `.overlay.show`; the rail out of the binnacle's scroller in
   replay; the Log on the same rail. (§1 rows 2, 3, 7; U-27.)
3. **The Layers panel.** Anchored above the deck with its own scroll; above the loop plate; hidden under overlays
   (`.edge`). Map keys 16 pt in. (§1 rows 8, 9, 18, 20.)
4. **Pages outside index.html.** `legal.css` top padding `calc(16px + inset)`; `about.html` bottom padding; the ETA page's
   NaN; while in there, the paper tokens and the "‹ Garage" row (U-26, U-43). (§1 rows 11, 12.)
5. **Strip and sheets.** Notes strip gutter 16 px and the idle line's padding; the hazard call `nowrap` at 375 pt;
   the plan sheet's body reserves the Find bar and gets the fade; sticky header fade; landscape plan sheet as two
   columns. (§1 rows 13 to 17; U-24.)
6. **Tapedeck and Billet bugs.** Landscape bar meters under the readouts; the Billet drum's tenths digit; the replay
   thumbnail in theme colours; the Pro-trial banner into the status line. (U-28, U-29, U-39.)
7. **The e2e safe-area flow grows** to mini and SE, the eleven missing screens, corner, overlap and gap tests, and
   writes the six-shape contact sheets as a CI artefact. (U-23, U-05.)
8. **Photo viewer** as a lightbox on `body`. (U-25.)
9. **Live Activity** to the HIG: short call, glyph minimal, margins, two-line note, hazard orange. (U-35.)
10. **The slide switch component** at 44 x 24 with travel, replacing the toggle in Layers, Garage and Friends; values in
    ink, not red; Night as Auto / Day / Night. (U-44.)
11. **Plan sheet: one loop control**, no chips, no helper prose; "Start from" as a row. (U-31.)
12. **Browser controls out**: file inputs behind ink keys, ranges as balance sliders, selects as row lists, on the drive
    page, Stages and Compare. (U-18.)
13. **Crew settings behind a gear**; Routes shared and Spots as rows; the old list deleted. (U-30.)
14. **Log index** with the sparkline rows and one summary row; Stages' empty state as one line with the action on the
    drive. (U-32, U-33.)
15. **Score placeholders and small language fixes**: "--" in the numeral font; "points" gone; Works stickers with
    initials; one back glyph; link weights on the route card. (U-34, U-41, U-42.)
16. **The Limit sign** on the binnacle in all three themes. (U-40.)
17. **Replay controls** as one switch and a scrubber; tab bar hidden in replay. (U-45.)
18. **Kit** at 80 px with idle and lean frames; the "KIT SAYS" line wraps. (U-38.)
19. **Night as a mode** on the binnacle. (U-36.)
20. **Capture stubs** for the route card with corners, friends on the map, the Plan a drive form, the crew board and
    chat, so the next review can judge the four mockups this one could not. (U-37.)
