# Vetta: third design review

Reviewer: senior product design (mobile, automotive HMI, games UI); this time with the code and a hand on it.
Evidence: 144 captures on three phone shapes (iPhone 15 Pro upright and on its side, iPhone SE) of 50 screens with a
stubbed Worker (the drive page and Compare were not re-shot: the capture Log had no drive; their rows are REVIEW2's and the
e2e flows cover them), the five review stills from `tools/app_tour.js` (a routed mountain road, two friends and
a home zone, Plan a drive, the crew board and chat, Tapedeck on a live drive), and the code behind each screen:
`web/index.html`, `controls.css`, `row_select.js`, `confirm.js`, `crew_events.js`, `crew_page.js`, `builds.js`,
`garage_ui.js`, `feedback.js`, `safety_ui.js`, `friends_map.js`, `spots_feed.js`, `instruments.js`, `analysis.html`,
the legal pages and `e2e/smoke.js`. The cited captures are in `screens-v3/` (JPEG, 1x), before and after.

Unlike the first two reviews, what I was sure of I fixed in this branch (five commits, named in the tables); what is
large, risky or the owner's is in Roadmap 3. Every change ran the deterministic tests (`pytest tests`, 665 passed) and
the full e2e suite (`node e2e/smoke.js`, 56 flows); a test that encoded the old design was moved to the new intent, never
weakened.

## Verdict

Both earlier roadmaps are built, and it shows: the driving screens, the route card, the crew page, the theme picker and
the Garage read as one instrument, and the safe-area work holds on every shape I shot. What was left was exactly what
`docs/STATE.md` named and a layer under it: the social forms. Plan a drive was the browser's date picker, time picker,
three selects and three checkboxes inside a page that had just been given stamps and slide switches; the same selects
and checkboxes sat in Add a step, the car form, the report sheet, the livery editor and Feedback; four places still asked
for a name with the system's prompt box; and chat boxes carried the browser's resize grip. None of these are big, but
each one is the costume slipping, and together they were most of what a crew member touches in their first week.

Those are fixed. The row list (`row_select.js`) now draws every select the app makes; the slide switch replaces every
checkbox (and is read through `.checked`, so nothing behind it changed); the confirm sheet learned to ask for a word
(`ApexConfirm.prompt`), so Pin place, presets, privacy zones, Tried it and the DELETE confirmation never leave the app's
hand; the day of a crew drive is a strip of thirty stops and its time a stepper, both new in `controls.css`.

On the driving screens I found three real faults the stills had been hiding: the lead call's modifiers ended in
"OVER CRE…" on a phone, Tapedeck's bar meters overprinted the Sight box and the trip on a 15 Pro (not only an SE), and
the dial's 0 and 140 touched the numeral by day. All three are fixed. A friend's tag near the right edge ran under the
Layers key; it now swaps sides. The Tapedeck "Finding GPS…" bug from STATE was the tour's, not the app's: the scene fed
frames to a page that had not started a drive; it now starts one as the shell does, and the still reads "Rec 1.06 mi".

What remains is small and listed: the Garage below the cars is still a long settings page (Roadmap 3, 1), the fonts come
from Google (2), one promise in About says "No subscription" while a Pro subscription is planned (3, the owner's), and
the motion work from the mockups (the picker's live preview, the onboarding loop) is still to do (5).

---

## 1. Against the principles

| Principle | Verdict | Evidence |
|---|---|---|
| Bespoke and tactile, never the browser's own | **Met now.** Before this review the app still drew 11 `<select>`s, 6 checkboxes, a date and a time picker and 4 system prompts (`§3.1`). After: none on any screen I can reach; `e2e` "crew drives" asserts the form shows none. The two that remain are the file pickers behind ink keys (the right way) and the clipboard fallback prompt when the clipboard API is refused. | `screens-v3/before-plan-a-drive.jpg` → `after-plan-a-drive.jpg`, `before-car-edit.jpg` → `after-car-edit.jpg`, `before-feedback.jpg` → `after-feedback.jpg` |
| Red only for record and destructive | **Met, with four corrections.** The Layers key turned red when open, the Crew tab's request count was a red badge, the keyboard focus ring was red, and three destructive links (Remove a car, Leave a crew, Unfriend) were plain ink. Now: ink, ink, ink, red. Kept as designed: the Sight value, the bank readout and the hazard-modifier words, which the theme contract names. Also fixed in `e4536c7`: every toast's border was red (ink now) and the route card's 186 corner ticks were red (ink). | `before-layers.jpg` → `after-layers.jpg`, `after-garage.jpg` |
| Unknown stays "--" | **Met.** Every slot I found unknown showed "--" (Limit, Sight, Score, the card's Surface and Cameras dials, the trip's road, a member who does not share). One honesty fault was the tour's: a live Tapedeck still said "Finding GPS…" with a fix because the page had never been told a drive began (fixed in the tour, §2). The "--" at the score's size is two bars in any font at 56 px; I tried the UI face and reverted (§3.2). | `after-tapedeck-drive.jpg` |
| Empty states: one line and an action | **Met, three lines shortened.** Crews near you lost its second sentence; Routes shared says "Share one from a route card"; Spots near you hides its lone "All" filter until there is something to filter. The Log and Stages lines from Roadmap 2 hold. | `after-crew-settings.jpg` |
| Power one or two taps deep | **Met on the Map, Log and Crew.** Plan a drive is two taps (Crew drives row, Plan a drive); crew settings one (the gear). The Garage is the exception: twelve settings sections scroll below the cars at depth zero (Roadmap 3, 1). | `after-garage.jpg` |
| No emojis | **Met, now tested.** Chat and build replies draw bodies through `ApexFormat.noEmoji` (U-46), with a unit test over the function and the two call sites. Nothing in the chrome uses one. | `tests/test_format.py` |
| Legibility floors | **Met, one collision fixed.** The 21 px call and the 13 px binnacle floor hold in all three themes, day and night; the Limit sign is the white sign everywhere. The dial's end labels (0 and 140) touched the 42 px numeral on a 120 px dial by day; they give way below 480 px as they already did at night. | `before-replay-roadbook.jpg` → `after-replay-roadbook.jpg` |
| Safe areas | **Met.** 42 screens on 15 Pro upright, 15 Pro on its side and SE: nothing under the island, the home indicator or a corner. The e2e flow's overlap and gap tests still pass with the new controls. | capture set |

---

## 2. Screen by screen

Same shape as REVIEW2 §2. "FIXED" names the commit on this branch; "OPEN" points at Roadmap 3.

| Screen | What I saw | Fault | What I did / recommend |
|---|---|---|---|
| Onboarding | Logo, tagline, the strip preview with a hazard plate, one Start key, Watch a replay. | Start was a plain ink bar; the rest of the app starts with the red record key. The preview is still static (REVIEW2 asked for a three-call loop). | FIXED `ac7892c`: Start is `.rec-key` with the dot. Loop: OPEN, Roadmap 3 item 6. |
| Map idle | Deck, red Start, the loop tulip, Layers key 16 pt in. | None. The place plate needs a fix and weather, which the stub has not. | Keep. |
| Layers open | Rows with slide switches, Who sees me, Co-driver below a rule. | The Layers key turned red when open. The switch thumb and track were the same size and read the same in both positions ("a dark block on the left" on and off). | FIXED `db97b16`: open key in ink; the thumb carries a grip line, so it is the knob in both positions. |
| Plan sheet, More | One dial with five ticks, the Roads switch, More; stamps and balance sliders. | The More row's chevron touched the last word ("start point⌄"). | FIXED `ac7892c`: 12 px of air before the chevron. |
| Route card (routed, 186 corners) | Three stamped numbers, the profile with corner ticks, facts with glyphs, four dials with two "--", two alternative tiles, record key + Preview, links in two weights. | 186 red ticks under the profile read as a barcode (red for information); "1 café" wears the viewpoint glyph. | Ticks: FIXED `e4536c7` (ink at 55 %). Glyph: OPEN, Roadmap 3 item 5. |
| Driving, Roadbook day | One status line, Report and End, dial, Limit sign, Sight, drum, g-ball with Score. | The numeral "27" touched the dial's 0 and 140 labels. | FIXED `ac7892c`. |
| Driving, Roadbook night | Larger numeral, Trip key, the labels gone. | None. | Keep. |
| Replay, Roadbook | The lockup, the scrubber, one Play switch, the speed detent. | "OPENS · OVER CRE…": the lead call's modifiers lost their end on a 393 pt phone because the next-note box kept 38 % of the strip. | FIXED `ac7892c`: 2fr 1fr on phones; the next note is the one that shortens. |
| Replay, Tapedeck | VFD, Kit at 80 px, KIT SAYS on two lines, bar meters. | The bar meters overprinted the Sight box's right edge and "TRIP MI OF 35.6" on a 15 Pro (the own-row rule only applied under 360 px). "OVER…" worse than Roadbook (the dot font is wide). | FIXED `ac7892c`: the meters get their own row up to 480 px; Tapedeck's modifiers may take a third line. `before-replay-tapedeck.jpg` → `after-replay-tapedeck.jpg`. |
| Replay, Billet | Metal, glow, the drum's tenths digit present. | Same modifier and dial-label faults as Roadbook. | FIXED with the above. |
| Tapedeck, live drive (tour still) | Status "FINDING GPS…" with a good fix; a dark band between map and binnacle. | The tour pushed `window.apex.live` frames to a page that had never started a drive, so no recorder existed and the status could only say so. A real iOS drive starts through the shell and reads "Rec". The band was the map's bottom padding under a live binnacle. | FIXED `ac7892c` in `tools/app_tour.js`: the scene fakes the shell with `?shell=1`, starts the drive through the app link, then feeds frames. The still now reads "● REC 1.06 MI". `before-tapedeck-drive.jpg` → `after-tapedeck-drive.jpg`. |
| Hazard report | Six plates, Cancel. | None. | Keep. |
| Drive ended | Kicker, name, meta, the score, one sentence, two keys, two links. | "Open in the Log" and "Done" sat on different baselines. The "--" is two bars at 56 px in any face (§3.2). | FIXED `db97b16` (baseline). Bars: accepted, see §3.2. |
| What's new, confirm sheet, crash check | Fine. | A red focus ring on the key the page had focused (Got it, Cancel, I'm OK) read as an error state. | FIXED `db97b16`: the ring is ink and only after a Tab or arrow key (`html.kbd`), never after a tap or a sheet's own `focus()`. |
| Crew, signed out | Logo, three glyphs, one line, Sign in. | None (Apple's key is native and does not render here). | Keep. |
| Crew page | Cover, crest, motto, meta, livery line, Next drive, board, chat. | The header says the crew's name and the page says it again 300 pt lower. Chat's box had the browser's resize grip. | Grip: FIXED `db97b16`. Header: OPEN, Roadmap 3 item 8 (make the header quiet). |
| Crew drives (pop) | The list and Plan a drive. | "Crew drives" twice (the pop's head and the section's own h3); the same on Spots near you and Routes shared. Going / Maybe / Can't were three keys for one answer. | FIXED `f800c68`: a pop drops a heading that repeats its head; the answer is a slide switch. `before-crew-drives.jpg` → `after-crew-drives.jpg`. |
| Plan a drive | The form. | The browser's select for the crew, date and time pickers, checkboxes for the route, the meet listing and the template, selects for lead and sweep ("Sweep: some…"), "Notes (optional)", "What (e.g. …)", and the Plan a drive key still showing above the open form. | FIXED `f800c68`: row lists, a 30-day strip, a time stepper, slide switches, the key gives way, the words. `before-plan-a-drive.jpg` → `after-plan-a-drive.jpg`. |
| Crew settings | Crews, a select, a name field, Create, Crews near you. | The select "Private: invite link only" sat between the crew card and the name field, so it read as the existing crew's setting; the crew card gave no sign it opens; the empty state explained in two sentences. | FIXED `db97b16`: "New crew" label, a Private / Public switch, a chevron on the card, one line. `before-crew-settings.jpg` → `after-crew-settings.jpg`. |
| Spots near you, Routes shared | Empty. | A lone "All" stamp with nothing to filter; "Routes friends and crews share show up here." with no action. | FIXED `ac7892c`. |
| Friends panel | Switches, the three choices, home zones, one paragraph. | None. | Keep. |
| Friends on the map (tour still) | Two pucks, a hatched home zone. | @sam's tag ran under the Layers key and off the right edge. | FIXED `ac7892c`: a tag near the right edge sits on the puck's left, and swaps back after the map moves. `before-friends-map.jpg` → `after-friends-map.jpg`. |
| Garage | You, the car card, Look and voice, Co-driver, Night, The words, Map motion, About, Sources. | "Garage" as the sheet's title and again as the cars' heading; the nickname as “RED” in tracked caps; "Shown to friends" a solid key for a state; Remove in ink; the car form's fields lost their names once filled ("Red" beside "Classic Red"); "VIN (optional)". | FIXED `db97b16`: "Your cars", the nickname plain, a slide switch, Remove in red, a small name over every field, "VIN, if you have it". `before-garage.jpg` → `after-garage.jpg`, `before-car-edit.jpg` → `after-car-edit.jpg`. |
| Build thread | Header, stage bar, numbered step, parts as stamps, the suggestion on its red rule. | A reply's actions (Delete, Report, Tried it) came before its words. Add a step used two selects and "e.g."; Tried it asked with the system prompt. | FIXED `db97b16`. |
| Feedback | Three chips, the box, two checkboxes, Send. | Two blue browser checkboxes under a box with a resize grip. | FIXED `db97b16`: slide switches, left-aligned labels. `before-feedback.jpg` → `after-feedback.jpg`. |
| Your data | Keys and links. | "Delete drives on this phone" was ink; "Erase everything" red. | FIXED `db97b16`: both red. |
| Report sheet | Reason select, note, Also block checkbox. | Browser controls. | FIXED `db97b16`: row list and a switch; "What happened" without "(optional)". |
| Livery editor | Crests, stripes, the locked tiers. | Three selects (pinned route, house stage, badge member). | FIXED `db97b16`: row lists. |
| Log, Stages, drive page, Compare | Hero, summary row, the empty lines; the row lists from Roadmap 2 (the drive page and Compare as the e2e flows render them). | None new. | Keep. |
| Privacy, Terms, Licences | App tokens, "‹ Garage". | The licences page cited "THIRD_PARTY_NOTICES.md (IDEAS L-03)" to the reader. | FIXED `ac7892c`. |
| About (in the Garage) | Version, four promises, Sources, links. | "No subscription." while Pro by subscription is the plan in MONETIZATION.md and the theme picker already says PRO. | OPEN, Roadmap 3 item 3: the owner's words. |
| Shared ETA page | "This link isn't working. Ask for a new one." | None. | Keep. |

---

## 3. Code level

### 3.1 Components

- **`row_select.js` is now loaded by `index.html`** as well as `analysis.html`, and every `<select>` the app draws goes
  through `ApexRowSelect.enhance` once it is in the DOM (the key is inserted beside the select, so the select needs a
  parent first; `builds.js`, `crew_page.js`, `safety_ui.js` and `crew_events.js` enhance after appending; `garage_ui.js`
  wraps each field in a label first). The hidden select keeps the value, so `.value` reads and `change` events are
  unchanged.
- **Checkboxes became the slide switch** with a `.checked` property defined on the button, so `withRoute.checked`,
  `attach.checked`, `share.checked` and `alsoBlock.checked` read as before. `crew_events.js` has the helper (`sw`);
  the others inline it. A shared `ApexControls.switch(label, on)` would remove three copies (Roadmap 3, 9).
- **`controls.css` gained two shapes**: `.detents.scroll` (a long scale that scrolls sideways, a stop with a word under
  its number: the day strip) and `.stepper` (two keys and a value in the numeral font: the time). The confirm sheet
  gained `.cs-field` and `.cs-ok` for `ApexConfirm.prompt`.
- **`ApexConfirm.prompt(text, { action, value, placeholder, maxLength, match })`** is the app's own prompt box. With
  `match`, the key waits for an exact word (the DELETE confirmation). Escape, Cancel and a tap outside resolve null.
- **The slide switch's thumb has a grip line**, so it reads as the moving part in both positions. The 44 x 24 geometry
  is unchanged.
- **The focus ring** is ink and shows only after a Tab or arrow key (`html.kbd`, set in `index.html` and
  `analysis.html`); a tap or a sheet's own `focus()` draws none.
- `textarea { resize: none }` on both pages.

### 3.2 Copy

- "e.g." is gone from every placeholder ("like Coilovers in"); "(optional)" from Notes, VIN, Convoy name, What
  happened (BRAND §2's banned list). "Name it, like Cherohala Saturday" names the field by what goes in it.
- The licences page no longer names a repo file to the reader.
- Kept, as a call: the g-ball's "BRAKE" engraving. REVIEW2 asked for "BANK"; the ball rolls forward under braking and
  the engraving names that direction, while the bank readout prints "BANK −2.8°" below. Two labels for two things.
- Kept, after trying: the unknown score "--" at 56 px. In Barlow Condensed and in Inter Tight the hyphen is a bar at
  that size; two of them in pencil are what "--" looks like big. The e2e flows that shot it without the web font were
  seeing the system hyphen, which is the same. I reverted the UI-font attempt in the same session.
- Open: "No subscription." (Roadmap 3, 3); "Road: Connector" shows an archetype name as a road (3, 6).
- Fixed in `e4536c7`: the camera toast reads "Camera map offline. No pins doesn't mean no cameras." (BRAND §2, row 1).

### 3.3 Accessibility

- Every new control has a role and a state: the day strip is a `radiogroup` of `radio` stops with a full date as each
  stop's label; the stepper's keys are "A quarter hour earlier / later"; the answer switch is a `radiogroup`; the
  slide switches are `switch` with `aria-checked`; the row-pick key's label reads "Sweep: @bob sweeps".
- The report sheet focuses its row-pick key (not the hidden select) on open; its Tab trap still lists `select`, which is
  hidden and skipped by the browser.
- The Hear keys were already labelled ("Hear Marguerite"); the Layers and Garage switches already carried
  `role="switch"`. Dynamic Type on the reading pages holds through the new controls (they inherit the zoom).
- Still not done: a VoiceOver pass on the simulator (U-15), which no capture here can stand in for.

### 3.4 Dead or duplicated UI

- The duplicated "Crew drives" / "Spots near you" / "Routes shared with you" headings inside their pops: gone.
- "Garage" twice (sheet title and section): the section is "Your cars".
- The Plan a drive key no longer sits above its own open form.
- `tryTheme('roadbook')` from the debug hook starts a "trial" of the free theme with a Stop plate; unreachable from the
  UI, left alone.
- The `prompt()` fallback in `copyText` (when the clipboard API refuses) remains: a last resort on the website only.

---

## 4. IDEAS.md additions

| id | idea | impact | effort | from |
|---|---|---|---|---|
| U-47 | Bundle Barlow Condensed and Inter Tight with the app (OFL, notices in THIRD_PARTY_NOTICES and the licences page) so the binnacle looks the same with no signal and no request goes to Google Fonts | M | S | REVIEW3.md §Verdict |
| U-48 | The fourth promise in About and on the landing page says "No subscription" while Vetta Pro is planned as one; the owner picks the words (for example "Free to drive. No ads, no data sold, nothing you made ever behind a paywall") and `tests/test_no_downloaded_code.py` follows | L | S | REVIEW3.md §2 About, docs/MONETIZATION.md |
| U-49 | The Garage below the cars is a settings page again: twelve sections at depth zero. Rows (Co-driver, Privacy, Units, Your data, Spots, Map motion, About) that open side pops, as the crew page's rows do; Look and voice stays on the page | M | M | REVIEW3.md §1 Power, REVIEW.md 3.2 |
| U-50 | The "along the way" fact on the route card uses the viewpoint glyph for a café (and a fuel stop): one glyph per kind | L | S | REVIEW3.md §2 Route card |
| U-51 | Motion from the mockups: the theme picker's preview speed breathes 38–42 on a 4 s loop, the onboarding strip cycles three calls every 3 s; both still under Reduce Motion | M | M | REVIEW2.md §2 Theme picker, Onboarding |
| U-52 | The crew page header repeats the crew's name over the page's own title: the header in pencil at 15 px (a breadcrumb), or the name only once | L | S | REVIEW3.md §2 Crew page |
| U-53 | MapLibre's attribution control is the stock white round "i": square it on the app's tokens, dark in the dark themes | L | S | REVIEW3.md §2 Tapedeck live |
| U-54 | One `ApexControls.switch(label, on)` for the slide switch, replacing the four copies in crew_events, garage_ui, feedback and safety_ui | L | S | REVIEW3.md §3.1 |
| U-55 | "Road: Connector" on the binnacle prints an archetype name; say what the driver sees ("Ramp") or drop the type while it is a connector | L | S | REVIEW3.md §3.2 |
| U-56 | On an SE in Tapedeck a toast lands on the Replay and trial plates at the top of a short map; toasts below the plates, or the plates aside while a toast shows | L | S | REVIEW3.md captures |
| U-57 | CarPlay and the Live Activity have never been in a review capture: screenshots from Xcode on the owner's Mac, then a review of both against the HIG | M | S | REVIEW2.md §1, owner |

Re-ratings: U-18 `done` (every select, checkbox, date, time and prompt the app drew is its own; file pickers behind ink
keys are the design); U-33 `done` (Crews near you, Spots near you and Routes shared are one line and an action);
U-46 `done`; U-37 note: the Tapedeck still is a shell drive, so it reads "Rec".

---

## 5. Roadmap 3

Each item is one PR, sized S (a day) or M (a few days).

1. **The Garage's settings behind rows** (U-49, M). Rows that open side pops, the crew page's pattern; Look and voice
   and the cars stay on the page. This is the last screen that scrolls through twelve sections.
2. **Fonts in the bundle** (U-47, S). Two OFL families, the notices, `tools/csp.py` unchanged (same-origin).
3. **The fourth promise** (U-48, S, owner). One sentence, two places, one test.
4. **The café glyph** (U-50, S).
5. **Motion from the mockups** (U-51, M): the picker's breathing preview, the onboarding loop.
6. **Small words and plates** (U-52, U-55, U-56, S): the crew header, "Road: Connector", toasts over plates on an SE.
7. **The attribution control on the tokens** (U-53, S).
8. **One switch helper** (U-54, S).
9. **CarPlay and the Live Activity in a review** (U-57, S plus the owner's Mac).
