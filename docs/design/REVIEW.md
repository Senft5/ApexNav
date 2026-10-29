# Vetta: design review and direction

> **Owner's note (2026-10-29), applied throughout:** the score is the **Vetta Score**, a multi-factor score (speed is
> one of its parts). It is not a "smoothness score", and the app and store copy do not explain how it is worked out.
> Score labels in this review and the mockups were changed to match; nothing else was.

Reviewer: senior product design (navigation, automotive HMI, motorsport graphics, community products).
Evidence: the 54 captures in `screens/` (day-01..27, night-01..27), `BRIEF.md`, `BRAND.md`, `PHILOSOPHY.md`.
Mockups: `index.html` in this folder links twelve 390 x 844 screens, each self-contained HTML with a PNG render in `png/`.

The short version. The current build already made the hard decisions well: paper and ink, one red pen, tulips, a real binnacle, honest "--". What it has not done is let any of that *do* anything. Almost every screen is a stack of outlined rectangles with words in them, the same rectangle whether it is a 15-mile loop, a tag called "Wet", or "Erase everything on this phone". The road book is a costume on top of a settings app. The fix is not more decoration; it is giving every control a shape that says what it does, cutting the number of things on each screen by half, and letting the three or four moments that matter (opening the map, reading a route, driving, meeting the crew) feel like handling a good instrument.

---

## 1. Diagnosis: why it feels like "a list of capabilities with boring buttons"

### 1.1 The root causes (apply to every screen)

1. **One component for everything.** The 1.5 px outlined box in sentence case is the choice chip, the toggle, the primary action, the tag, the preset, the stat tile, the table, and the section. When everything is a box, nothing has a shape, so the eye cannot tell a destructive action from a filter from a value (`day-10-route-card.png`, `day-18-log-drive.png`, `day-22-settings-1.png`). Brand rule "rules, not boxes" exists on paper but the captures are boxes inside boxes.
2. **Options are shown instead of a default.** The plan sheet shows 21 controls before the user has typed a letter (`day-07-plan-sheet.png`). The route card shows three route options, three road modes, seven actions and two links at once (`day-10`, `day-11`). The co-driver philosophy ("quiet until the road gets interesting") is not applied to the UI itself.
3. **Numbers are set like prose.** "70.1 mi · 168 min (+12 for fun) · 360 corners / 9 viewpoints · no fuel for the first 51 mi / Climbs 14,856 ft in all..." is five lines of equal-weight body text (`day-10`). An instrument shows three big numbers and a profile; this reads like a terms page.
4. **The driving screen is not full-screen.** The tab bar stays up while driving (`day-13-driving.png`, `night-13`), eating 80 px and offering four ways to leave the drive by accident. Status text ("No motion · surface not recorded · Keep the screen on") wraps under the record line in the most valuable area of the screen.
5. **Hazards look like the route.** Red is the route, the record button, the needle, the Sight chip, and the hazard. In `day-16-replay-demo.png` CREST/DIP plates are ink-on-paper with no colour at all, and the crest arrow in the notes strip is a small red mark. There is no single, fixed, unmistakable hazard language.
6. **Flat, not tactile.** Nothing has depth, travel, or detent. The toggles in `day-06-map-menu.png` are a square sliding inside a rectangle; the "dial" is a flat SVG; the drum odometer is the one thing that looks like it has a surface (`day-13`), which is why it is the one thing people remember.
7. **Empty states are paragraphs.** "No stages yet. A stage is a stretch you drive often..." in a bordered box (`day-20-stages.png`); Convoy explained in 45 words before a text field (`day-26-crew-member.png`). The app explains instead of showing.
8. **Night is an inversion, not a mode.** `night-05`, `night-13`, `night-17` are the day layout with swapped tokens. At night in a car the layout should also change: fewer elements, larger numbers, lower map contrast, warmer paper. Night is currently a theme toggle in a side menu rather than something the app does.

### 1.2 Screen by screen

| Screen | Capture | What is wrong | What it should be |
|---|---|---|---|
| Onboarding 1 | `day-01` | Logo and tagline centred in 844 px of empty paper; "Watch a replay" is the most interesting thing on the screen and it is a text link at the bottom. | Put the replay behind the logo: a 10-second silent loop of the notes strip calling corners on a real road. The product sells itself in one look. One button: Start. |
| Onboarding 2 | `day-02` | Six identical bars for voices; "My Voice" and "Phone voice" sit between named people; no way to hear them before choosing. | Voices belong to themes now (section 4). First run picks nothing; Roadbook ships with Marguerite. Remove this step. |
| Onboarding 3 | `day-03` | A sign-in wall dressed as an onboarding step, before the user has seen a map. | Delete. Sign-in happens at the first social action (Crew tab, Share). |
| Map idle | `day-05`, `night-05` | Fine bones, but it is a map with a search bar: nothing invites. The side tab (sliders icon) is a mystery; there is no sense of place or weather; no suggestion. | Mockup `01-cockpit-idle.html`: a place and weather plate top-left, Layers and Recenter as two physical keys, the deck with one search line and the record key, and one suggested loop drawn as a tulip ("Loop from here · 45 mi · twistiest nearby · Map only until driven"). |
| Map menu | `day-06` | Eight switches titled "While you drive" that mix map layers (Twisty roads, 3D terrain) with co-driver settings (Notes, Voice) and a theme toggle (Night). | Split: Layers (map things) live behind the Layers key on the map; co-driver settings live in Garage. Night is automatic (sunset) with an override in Garage, not a switch here. |
| Plan sheet | `day-07`, `day-08` | 21 controls, 6 labels, before any intent. "Loop", "Explore", "Roads", "Avoid", "Hairpins", "Sweepers" are all the same chips. Loop and Explore compete (miles vs minutes) for the same job. | Mockups `02-plan-basic.html` and `03-plan-more.html`. Basic: search + three recents, one loop dial with five detents, one three-position Roads switch, one disclosure row. More: presets, avoid stamps, corner-mix balance sliders, prefer stamps, start/finish. |
| Route bar | `day-09` | Good: compact, red Start. The floating toast duplicates the bar's text. | Keep. Drop the toast; the bar is the toast. |
| Route card | `day-10`, `day-11`, `night-10` | Five lines of prose for numbers, three red bars with no scale, "Options" chips that repeat the "Roads" chips below them, seven actions, Save/Share/Share ETA/GPX/Pin place at equal weight with Drive it. | Mockup `04-route-card.html`: three stamped numbers; an elevation profile with corner ticks and named legs; four small dials (Twist, Flow, Surface --, Cameras --); facts with glyphs; the alternatives as three tiles; record key + Preview; everything else as text links. |
| Permissions | `day-12` | Good copy, correct moment. | Keep as is. One of the best screens. |
| Driving | `day-13`, `night-13` | Tab bar visible; status prose wraps; Sight chip (red outline) competes with the hazard colour; Limit and Sight are same-size boxes though one is a sign and one is advice; the "brake" g-ball has no bank reading; "--" floats alone under the odometer with no label. | Mockups `05-drive-roadbook.html`, `06-...-night.html`: notes strip (distance, tulip, call with modifiers smaller, next call), fixed hazard plate, map, binnacle with one status line, Report and End, a real dial with the road-speed band, the white Limit sign, drum trip, and the g-ball reporting a live Score. No tab bar. |
| Hazard report | `day-14` | Six identical outlined boxes; the map dims but the notes strip stays active, which is right. | Keep the six, make them the hazard plate style (black, orange edge) so the report *looks like* what others will see. One tap, no confirm, 3-second undo in the status line. |
| Drive ended | `day-15` | A toast with "View" and a blank grey rectangle (bug). The most emotional moment of the app (you just drove the Skyway) gets 30 px. | A full card: route name, distance, Vetta Score big, one sentence, "Save to Log" implicit, "Share card" and "Mark a stage" as the two actions. |
| Replay | `day-16` | Good screen. CREST/DIP plates on the map are ink only; "Fast & open" label under the trip is unlabelled; Pause/1X/Video as a third button language. | Keep. Plates adopt the hazard style for CREST/DIP that are hazards and the pencil style for road-type notes. |
| Log | `day-17`, `night-17` | Four bordered cards, all the same weight: Latest, Best, "2026 so far", "Your week", challenges, table. "Best Driver Score" uses the old name. "Import .csv" is the header action. | One hero number (latest Vetta Score with its road), a quiet year line, the drive list as a road-book index with a small corner-density sparkline per row. Challenges collapse to one line with a disclosure. Import lives in Garage > Your data. |
| Drive detail | `day-18`, `day-19` | Replay/Compare/Share/Share card as four boxes; tags as seven boxes in a box; the Score arrives after the tag form. Traces are good; grip circle is a lab plot. | Score first, big, with the one-sentence coaching line. Replay is the primary. Tags are a single row of small stamps. Traces keep their lanes. Grip circle becomes the same g-ball face used while driving, filled with the drive's dots. |
| Stages | `day-20` | A tab whose home state is an empty-state box and a form. | Not a tab. Stages live in Log as a segment (Drives / Stages). Creating one is an action on a drive ("Mark a stage"). |
| Crew signed out | `day-21` | Logo, "Drive with friends", Google button. | Fine; add one line of what you get (friends on the map, the board, crew drives) with the three glyphs. |
| Crew member | `day-26`, `day-27` | A single scroll of ten sections in identical type: You, Convoy (45-word explainer), Routes shared, Spots, Crew drives, Garage, Crews, Crews near you, Points board, Create a crew (a select and an input inline). The actual crew, Ridge Runners, is a small box halfway down. | Mockup `09-crew-page.html`. The Crew tab opens the crew (or a short list if several). Your own identity, cars and settings move to Garage. The crew page has livery, next drive, board, builds, chat. |
| Settings | `day-22`..`day-25` | Twelve sections of help text with controls underneath. "Look" shows colour variants locked behind "-- Octane" (banned word, and theme-as-colour-swap is exactly the sterile version of theming). "Erase everything on this phone" is a plain underlined link. | Settings become the gear inside Garage. Look and voice becomes the theme picker (`11-theme-picker.html`). Destructive actions are red text with a confirm sheet. Help text collapses under a "How this works" row. |

---

## 2. Design principles

Fun but not goofy, bespoke and tactile, visual design speaks to function. Six rules an engineer can test a screen against.

1. **Every control has the shape of its job.** A quantity is a dial with detents. A mode is a slide switch with travel. An exclusion is a rubber stamp. A record action is a red key with a bevel. A destructive action is red text behind a confirm. If two controls do different things, they must not look the same. (The current app fails this on every screen.)
2. **Numbers are instruments, prose is captions.** Anything measured is set big, tabular, condensed, with its unit small, and sits on a rule or in a bezel. Sentences are 13-15 px pencil and never carry a value. Unknown is `--` in the same slot at the same size; never hidden, never zero.
3. **The default is a decision, the options are a drawer.** Each sheet opens with one obvious thing to do and at most one disclosure row. Nothing a new user does not need is on the first level. Power lives one tap down, behind a row that names what is in it ("More: avoid, hairpins, surface, presets").
4. **Paper has texture, hardware has depth, nothing floats.** Roadbook: paper, 1 px hair rules, 2 px ink structure lines, radius 0, a 2-3 px drop under keys only. Pro themes may add glass, metal and glow, but nothing is a translucent blurred panel and nothing hovers over the map without an edge.
5. **Quiet until the road gets interesting.** Idle: calm, almost empty, one invitation. Driving: three big things and a fixed hazard place. The app's energy comes from motion that means something (the needle, the drum, the leaning fox, the route ribbon turning amber), never from decoration that animates on its own.
6. **Character comes from the voice and the theme, not from the chrome.** Roadbook stays refined. The fun lives in Tapedeck's fox and VFD bars, in Billet's glow, in each voice pack's lines. The shell under them is identical. No emoji, no exclamation marks, no mascots outside a theme that owns one.

How Roadbook becomes a system (what plugs in): see section 4.3, the theme contract.

---

## 3. Information architecture

### 3.1 First minute

1. Open: the map, a place plate, the deck with "Where to, or a loop from here" and the red Start key, and one suggested loop drawn as a tulip. Nothing else. (`01-cockpit-idle.html`)
2. Tap Start without a route: it starts recording and calling corners on whatever road you are on. This is the fastest route to the product's magic and it is currently buried behind "Where to?".
3. Tap the deck: the plan sheet at its basic level (`02-plan-basic.html`). Search, three recents, the loop dial, the Roads switch, Find roads.
4. The route card (`04-route-card.html`), Drive it, the permissions sheet (already good), driving (`05-drive-roadbook.html`).
5. End: a full "Drive ended" card with the Vetta Score big. First tap on Share or Crew asks to sign in.

### 3.2 Tab bar: four, not five

Map · Log · Crew · Garage.

- **Map** is the cockpit, planning and driving. Layers (friends, cameras, measured roads, twisty roads, terrain) are a key on the map, not a tab or a side menu.
- **Log** is every drive, with a segment for Stages and a collapsed challenges line. Stages stop being a tab: a stage is made from a drive and lived in from the Log.
- **Crew** opens your crew page (`09-crew-page.html`). If you are in several, a short switcher at the top. Convoy is a key on the crew page and a plate on the map while live.
- **Garage** is you: your cars and their build threads (`10-build-thread.html`), your profile and photos, Look and voice (`11-theme-picker.html`), the co-driver (Notes level, speak road names), privacy (home zones, friends layer defaults), your data, and the gear with the rest of today's Settings. Calling it Garage rather than Profile or Settings is not cosmetic: it is where car people expect to find their car, and it makes a settings page feel like a place.

Why four: five tabs with Stages and Settings as peers of Map says "here are our features". Four tabs that are places (the road, your log, your people, your garage) say what the app is for.

### 3.3 Where the power lives (progressive disclosure)

| Depth | What | Where |
|---|---|---|
| 0 | Start, search, loop length, Quick/Fun/Max fun | Deck and basic plan sheet |
| 1 | Avoid stamps, corner mix, prefer, start/finish, presets | "More" row on the plan sheet (`03-plan-more.html`). A saved preset appears as a stamp on the basic sheet so the power user's setup is one tap next time |
| 1 | Route alternatives, Save/Share/GPX | Route card below the fold |
| 1 | Layers | Layers key on the map |
| 2 | Events (crew drives): date, meet point, route, roles (lead, sweep), regroup points, RSVP | Crew page > Next drive > "Plan a drive" (a sheet built from the plan sheet plus date, meet point and roles) |
| 2 | Crew customisation (livery) | Crew page > Edit livery |
| 2 | Co-driver detail, road-side, units, sources | Garage > gear |

Rule of thumb: a new user should never see a control they cannot explain from its shape; a power user should never need more than two taps to reach any parameter.

---

## 4. Themes as Pro

### 4.1 Names and what each one is

- **Roadbook** (included). Paper, ink, one red pen. The refined version of today: fewer boxes, rules not borders, real dials, the drum, the call lockup. Day by default, Night after sunset.
- **Tapedeck** (Pro). A late-90s head unit. Near-black panel, blue-green VFD glow (`#7DF5DE`), amber secondaries (`#FFB347`), seven-segment speed and distance, dot-matrix call text, spectrum bars that are not decoration: the left bank shows live surface roughness, the right bank brake/turn load. And **Kit**, a dot-matrix fox who leans into the corner being called, sits up on a crest, curls up at idle, and blinks when a hazard is confirmed. Kit is an original character: a fox, not a dolphin, drawn on a 14 x 12 grid so it belongs to the display rather than sitting on it. (`07-drive-tapedeck.html`)
- **Billet** (Pro). Machined aluminium: brushed panel, knurled bezels, countersunk screws, black gauge faces, red glow needles and numerals (`#FF2A2A`), a white Limit sign exactly as on the road. The energy comes from the glow against the metal; the layout is still three things. (`08-drive-billet.html`)

### 4.2 What a theme may change

| Layer | Roadbook | Tapedeck | Billet |
|---|---|---|---|
| Type | Condensed numerals, grotesk labels, sentence case | Seven-segment numerals, 5 x 7 dot font for calls, mono caps for labels | Condensed numerals with glow, grotesk labels, caps for units |
| Colour | Paper / ink / red pen / amber caution | Black / VFD teal / amber / soft orange record | Graphite / bone / red glow / amber band |
| Gauges | Ink-on-paper dial, drum trip, g-ball with bank | Seven-segment speed, bar-graph surface and brake meters, numeric trip | Bezelled dial, LED trip readout, bezelled g-ball |
| Map style | Topo paper (day) / phosphor night | Dark with teal road edges, amber route | Graphite with bone road edges, red route |
| Motion | Needle sweep, drum roll, sheets slide 180 ms | Segment latch (no interpolation, values step), bar decay, Kit's 4-frame lean | Needle with slight overshoot and settle, glow bloom on value change |
| Sound | Soft paper click on keys, a single wood-block tick for the pre-call | Tape-deck key clunk, a short VFD "bip" for the pre-call | Machined click, a low tone for the pre-call |
| Voice pack | Marguerite | Kit | Hale |
| Idle | Place plate, suggested loop tulip | Kit curled up, bars at rest, "TRK" line shows the road name | Gauges at zero, glow dimmed to 40 percent |

### 4.3 What never changes (the theme contract)

These are tested, not trusted. A theme is a set of tokens, three renderers (dial, meter, strip) and an asset bundle; it cannot move or restyle the following:

1. **The hazard plate.** Black `#111111`, 2 px signal-orange `#FF7A1A` edge, white text, orange triangle glyph, 20 px condensed label, 12 px detail. Top-left of the map, 14 px below the notes strip, in every theme, day and night. The same plate is used on the map, in the notes strip when the hazard becomes the call, in the report sheet, and in the Log. The pre-hazard sound is the same two-tone in every theme and plays before the theme voice speaks.
2. **Layout of driving-critical information.** Notes strip at the top (distance left, tulip centre-left, call, next call right). Binnacle at the bottom with speed left, Limit centre, Score right. Report and End in the status row. The map in between. No theme may put anything over the route within 120 px of the puck.
3. **Legibility floors.** Speed numeral at least 40 px, call at least 21 px, nothing under 13 px on the binnacle, 4.5:1 contrast for every text token against its surface, 7:1 for the call and the hazard. Glow is additive and never substitutes for contrast (the Billet numerals pass without their glow).
4. **The call grammar and tulips.** Words, order and the tulip drawings are the product's language. Themes restyle stroke and colour; they do not redraw the glyph set.
5. **The Limit sign** is the white US sign in every theme. It is the one real-world object on the screen and it must look like itself.
6. **Unknown is `--`** in the same slot, same size, same colour role as a known value.
7. **The record key is the record key**: the Start/Drive it action is always a red key with a dot. Tapedeck's is soft orange on black because pure red on a VFD panel reads as an error LED; the dot and the bevel stay.
8. **Hazard pre-tone, crash check, convoy relay** behave identically; a voice pack only changes the spoken lines.

### 4.4 Voice packs

Custom voices go away. Each theme ships one co-driver with a character, a pre-tone and a line set. Lines are short, present tense, instruction first; the call itself ("Left four, tightens, long") is identical across packs. The character lives in the words around it.

**Marguerite (Roadbook).** Calm, exact, a step ahead. A pro co-driver on a Sunday.
- Pre-drive: "Notes ready. Seventy miles, three hundred and sixty corners. Have a good one."
- Call: "Left four, tightens. Long. Care."
- Hazard: "Gravel in four hundred. Reported two hours ago."
- Quiet mode: "Quiet from here. Bumps and cameras only."
- End: "That's the drive. Score eighty-two, your best on this road."

**Kit (Tapedeck).** Quick, dry, a little cheeky, never silly. The friend who rides shotgun and knows the road.
- Pre-drive: "Tape's in. Seventy miles. Let's keep it tidy."
- Call: "Left four, tightens. Easy in, late out."
- Hazard: "Gravel, four hundred. Sam called it. Trust Sam."
- Crest: "Crest. Light hands."
- End: "Eighty-two. Told you late out works."

**Hale (Billet).** Low, even, zero drama. A test driver reading a card.
- Pre-drive: "Route loaded. Seventy point one miles."
- Call: "Left four. Tightens. Long."
- Hazard: "Gravel. Four hundred."
- Quiet mode: "Hazards only."
- End: "Complete. Score, eighty-two."

Rules for every pack: no speed numbers unless the Limit is asked for; no praise for pace; "score" is the only score word, and no pack explains how it is worked out; hazards are always distance first; the same sentence length in every pack so timing is identical.

### 4.5 How themes are presented as Pro

- Garage > **Look and voice** (`11-theme-picker.html`). Each theme is a card with a live preview of its notes strip and speed at the top, its name, two lines, its voice with one sample line, and a Hear key that plays the sample. Roadbook is marked In use. Pro themes carry a small ink PRO tag, never a padlock, and can be previewed in full: tap a Pro card and the whole app switches for a 10-minute replay of the demo drive, then returns with a one-line sheet: "Tapedeck comes with Vetta Pro. See Pro."
- The theme picker is the only place Pro is sold inside the app, plus one line on the crew page livery box. No banners, no modals on launch.
- Pro copy: "Vetta Pro pays for the servers and the road-feel map and brings the Pro themes and crew liveries." Prices and the subscription-versus-lifetime decision stay with the owner (OWNER_TODO).
- Store review: themes and liveries are digital goods inside the app and must go through in-app purchase; the "See Pro" sheet must be the StoreKit sheet, not a web link. Update `docs/APP_REVIEW.md` in the PR that ships the picker.

---

## 5. Social

### 5.1 The currency: Decals

Pro members get one **Decal** per month per crew they belong to (and one more for each additional month of continuous membership, capped at three). A Decal is placed on a crew; it stays while the member stays Pro and in the crew. Decals are the supporter contribution that unlocks crew customisation. Why the name: on a rally car, the sponsors' decals are what make the livery, and more sponsors means a fuller livery; the metaphor and the mechanic are the same thing, and the word is already car-culture vocabulary (not Discord's).

**Livery tiers** (names from motorsport team structure):

| Tier | Decals | Unlocks |
|---|---|---|
| Plain | 0 | Name, motto, crest from the stock set, one stripe colour, cover photo |
| Club | 5 | Custom crest upload, two-colour stripe, a pinned route, crew chat pins, 3 event templates |
| Works | 12 | Full stripe pattern editor (three colours, five patterns), member badges, a custom board (choose which stage is the house stage), convoy call sign on the map, 10 event templates |
| Factory | 20 | Animated crest in the crew's own theme accent, a crew voice line for convoy regroup ("Ridge Runners, regroup at the overlook") in each voice pack, crew page in the share card, custom hazard report categories for crew drives (for example "Cattle grid") |

The crew page (`09-crew-page.html`) shows the tier, the count, the next threshold and the supporters' decals as little tilted stickers. Decals never buy standing on the board; the board is the Vetta Score only.

### 5.2 Photos

- **Profile photo**: one square, cropped in-app, shown at 40 px in boards and chat and 72 px in Garage. Default is the initial in a bezelled circle (as in the mockups).
- **Car photos**: a cover photo per car plus a gallery; the cover is used on build-thread posts and on the car card friends see. Uploads strip EXIF location by default (say so once, under the picker). A car card never carries where you drove or how fast.
- **Crew photos**: cover photo (chosen by anyone with the Club tier or above, otherwise the creator), crest, and event photos that attach to the drive they came from.
- Moderation: report on every photo, a 24-hour hide on report pending review, owner review tool. Required for the App Store with user-generated content: update `docs/APP_REVIEW.md` (UGC guideline, blocking users, EULA).

### 5.3 Build threads

`10-build-thread.html`. A car in your Garage can have one build thread. Structure, borrowed from the forum tradition the owner cited but made native:

- **Car header**: drawing or photo, name, spec line (owner-typed, never inferred), owner, crew, followers.
- **Stage bar**: the owner declares stages ("Suspension", "Brakes", "Power", "Interior") and the bar shows progress; it is the thread's table of contents.
- **Posts**: one per step, numbered, dated, with text, up to eight photos, a parts list as small stamps, and optionally the drive it was tested on (which brings the Vetta Score in as evidence: "My Score went from the 640s to 702 on the same road").
- **Replies** and **Suggestions** are different things. A suggestion is a reply the author marks as such (red rule); the owner can mark a suggestion "Tried it" with a result. This gives the thread a memory: next year's reader sees what was suggested and what happened.
- **Chat** is per-thread and ephemeral (30 days), for the back and forth that does not belong in the log.
- Follow a build to get a notification per new stage post, not per reply.
- Builds surface on the crew page (Builds row) and on a friend's car card.

### 5.4 Friends on the map

`12-friends-map.html`. A layer, off by default, with privacy that defaults to the safe side and is explained in one paragraph at the moment it is switched on.

- **Layer toggle**: Layers key on the map > Friends. Turning on the layer does not share you; sharing is a separate choice on the same sheet.
- **Show me to**: Nobody (default) / Crew / Friends.
- **Delay**: Live / 10 min (default) / 1 h. Positions are published with the delay applied, not just displayed late.
- **Position shown as**: Exact / Within a mile (default). Fuzzing is done on the server on a fixed grid, not by jitter, so repeated reads cannot be averaged back.
- **Only while driving** (default on): the phone publishes nothing when the app is not in a drive.
- **Home zones** (the existing privacy zones, renamed): inside one, nothing is published to anyone, convoy included. The map draws your own zones hatched; nobody else ever sees them.
- Friend pucks are initials in a bezelled circle with a tag ("about 10 min ago · within a mile", or "Driving · Skyway" if that friend chose Live and Exact). The tag always says how stale and how fuzzy the position is, so nobody mistakes the layer for live tracking.
- Nothing is retained after the layer is turned off; the server keeps the last published position only while sharing is on.
- Convoy keeps its own, stricter, time-boxed sharing (two hours, exact, members only) and is unaffected.

---

## 6. Roadmap

Quick wins first (each is a day or two in the web cockpit, no new backend), then the bigger moves. Each item: what to change and why.

### Phase 1: make it one product (two weeks)

1. **Hide the tab bar while driving; End and Report move into the binnacle status row.** Why: 80 px back for the map, no accidental exits, matches `05-drive-roadbook.html`.
2. **Introduce the hazard plate** (black, orange edge, fixed position) and use it for hazard pins, CREST/DIP plates, the report sheet buttons and hazard calls. Why: today a hazard looks like the route; this is the single biggest safety fix and it is CSS.
3. **Call lockup**: call in condensed caps, modifiers one size down in pencil, next call nowrap. Why: `day-13` wraps to four lines on long calls.
4. **Replace outlined-box chips with three shaped controls**: slide switch (modes), stamps (exclusions and tags), detent row (quantities). Why: principle 1; it is the same CSS everywhere and it ends the "list of boxes" feeling immediately.
5. **Route card as instruments**: three stamped numbers, profile with corner ticks, four small dials with `--`, actions reduced to record key + Preview + text links. Why: `day-10` is the screen that decides whether someone drives.
6. **Plan sheet basic/more split** with the loop dial and the Roads switch. Why: 21 controls to 7.
7. **Drive ended card.** Why: the emotional peak of the product currently gets a toast and a blank rectangle.
8. **Remove Octane and the colour-swap "Look" section**; remove onboarding steps 2 and 3. Why: banned vocabulary, and theming as colour swaps is the sterile version of what Pro will sell.

### Phase 2: structure (three to four weeks)

9. **Four tabs: Map, Log, Crew, Garage.** Stages become a Log segment; Settings move under Garage. Why: section 3.2.
10. **Layers key on the map** (friends, cameras, measured, twisty, terrain) replacing the side menu; Notes and Voice move to Garage. Why: map things with the map, co-driver things with the co-driver.
11. **Night as a mode, not a token swap**: automatic after sunset, larger numerals, lower map contrast, override in Garage. Why: `night-13` is day with inverted colours.
12. **Theme contract in code**: tokens plus three renderers (dial, meter, strip) and a test that asserts the invariants in 4.3 (hazard plate position and colours, minimum sizes, contrast). Why: without the contract, Pro themes will drift into unsafe layouts.
13. **Log redesign**: hero Vetta Score, road-book index rows with a corner sparkline, challenges collapsed. Why: `day-17` is four identical cards.
14. **Drive detail**: Score first, replay primary, tags as one stamp row, g-ball face for the grip circle. Why: the coaching line is the product's best sentence and it is below a form.

### Phase 3: Pro and themes (four to six weeks, after Pro purchase exists)

15. **Theme picker** with live previews and Hear keys; 10-minute full-app preview on a replay. Why: the only place Pro is sold; must earn it.
16. **Tapedeck**: VFD tokens, seven-segment renderer, bar meters wired to live roughness and brake/turn, Kit's four lean frames, key clunk and bip. Voice pack Kit. Why: the owner's "beautiful LCD" is the theme people will screenshot.
17. **Billet**: metal tokens, bezel renderer, glow numerals, needle overshoot. Voice pack Hale.
18. **Roadbook voice pack Marguerite** replaces the voice list; retire custom voices and Jarvis. Why: character per theme, and one fewer settings page.

### Phase 4: social (six to ten weeks, needs backend)

19. **Garage tab** with cars, photo upload (EXIF stripped), profile photo. Why: everything in 5.2 depends on it.
20. **Crew page v1**: cover, crest, motto, next drive, board, chat; Plain tier only. Why: the crew is today a box halfway down a list.
21. **Events**: Plan a drive for a crew (date, meet point, route, roles, regroup points, RSVP), the event card on the crew page and a reminder in the cockpit the morning of. Why: the owner's "event organisation"; it reuses the plan sheet.
22. **Decals and livery tiers** (Club, Works, Factory) with the livery editor. Why: the Pro supporter loop; only after 15 and 20 exist.
23. **Build threads**: car header, stage bar, posts with photos and parts, replies vs suggestions with "Tried it", follow. Why: the one social surface that gets better with age.
24. **Friends on the map**: layer, defaults as in 5.4, server-side delay and grid fuzzing, home zones honoured server-side. Why: last because it carries the most privacy risk and benefits from the Garage privacy page existing first.

### Not doing

- No XP, streaks, confetti or badges for speed or distance. Challenges stay about new roads and technique.
- No cyan/magenta, no blurred glass, no satellite tiles, no 3D building boxes (PHILOSOPHY.md bans; still right).
- No custom voices. No emoji anywhere, including in chat rendering (strip to text).

---

## Appendix A: mockup index

| File | Shows | Notes for the engineer |
|---|---|---|
| `01-cockpit-idle.html` | Map idle, Roadbook day | Deck is 2 px ink rule + paper; record key has a 3 px inner bevel; suggested loop is a tulip in a box, the only box on the screen |
| `02-plan-basic.html` | Plan sheet, level 0 | Loop dial: 96 px, five detents, red index mark; Roads: slide switch with a travelling ink thumb |
| `03-plan-more.html` | Plan sheet, level 1 | Presets as stamps; Avoid as stamps (filled = avoided); corner mix as balance sliders with detent ticks; sticky Find roads |
| `04-route-card.html` | Route card | Stats grid on a 2 px rule; profile SVG with corner ticks; four half-dials, two `--`; alternatives as three tiles |
| `05-drive-roadbook.html` | Driving, Roadbook day | Notes strip 132 px; hazard plate at top 146 px; binnacle 290 px; dial sweep 240 degrees with the digital readout in the gap |
| `06-drive-roadbook-night.html` | Driving, Roadbook night | Same layout; night tokens; shows the contract holds |
| `07-drive-tapedeck.html` | Driving, Tapedeck | Seven-segment SVG renderer; bar meters; Kit on a 14 x 12 dot grid; scanline overlay at 2.5 percent |
| `08-drive-billet.html` | Driving, Billet | Brushed gradient; knurl pattern bezel; glow via text-shadow and drop-shadow only, contrast passes without it |
| `09-crew-page.html` | Crew page | Livery box with tier, Decal count, progress to next tier; event card; Vetta Score board with `--` for a member who does not share |
| `10-build-thread.html` | Build thread | Stage bar; numbered posts on a timeline rule; suggestion (red rule) vs reply (ink rule); compose bar |
| `11-theme-picker.html` | Look and voice | Live mini previews per theme; PRO tag; hazard plate shown as the invariant |
| `12-friends-map.html` | Friends layer | Fuzz radius circles, stale/fuzzy tag on every puck, hatched home zone, defaults as specified |

Fonts: the mockups use system stacks (SF Pro Display / Avenir Next Condensed for numerals, SF Pro Text for labels, SF Mono for Tapedeck). In production keep Barlow Condensed and Inter Tight per BRAND.md; the Tapedeck dot font is a 5 x 7 bitmap drawn as SVG, not a web font. The PNGs were rendered on Linux without SF fonts, so numerals look wider there than they will on an iPhone.
