# Call sheet

Decisions Claude made for you, newest first. Each one says what was decided, why, and how to undo it. Read the top until
you reach one you've seen. If you disagree with a call, say so and it gets reversed; nothing here is hard to undo unless
it says so. Things only you can do are in docs/OWNER_TODO.md.

## 2026-10-29

**Roadmap 2 item 18: Kit drawn properly (U-38).** Tapedeck's fox is 80 px on a 16 x 14 dot grid, with ears, a lighter
body, a lit muzzle, a dark nose and amber eyes, so he reads as a face rather than a blob. Two idle frames (an ear flick,
a quarter second every five) and four lean frames wired to the corner: he leans with lateral g past 0.15 g, further
past 0.45 g. "KIT SAYS" wraps to two lines and the line keeps up to 64 characters instead of being cut at 40. My calls:
- *The ear flick stops under Reduce Motion*; the leans still follow the car, because they carry information.
- *The lean is a shear about the chin* with a two-dot margin at the ears, so no frame clips at the grid edge (a test
  counts the dots).
Undo: restore the `KIT` frames and `kitRow` in web/instruments.js and the `.kit` rules in web/index.html.

**Roadmap 2 item 17: replay controls (U-45).** A replay is full-screen like a drive: no tab bar, and the
"Replay · Demo · Dry Ridge Rd ×" plate is the way out. The elevation strip is the scrubber, full width above the
controls, with its position mark; under it, Play is one slide switch and the speed is a 1× 2× 4× 8× detent. My calls:
- *The switch label stays "Play"* rather than flipping between Play and Pause: a switch names its on state, and a
  constant label keeps the speed stops a full thumb wide on an iPhone SE.
- *With a dashcam video the Video key moves to the scrubber's row* (end of the strip) so the four stops stay 49 px wide
  on the smallest phone; without one the strip runs the full width.
- *Tapedeck's bar meters keep their own height.* Squeezed into the dial's square they spilled upward over the speed
  stops (and on main already overprinted Sight and the trip on an SE, and ran off the bottom on its side, REVIEW2.md
  row 6: the landscape rule named a selector that never matched). On a small phone upright and on its side the meters
  now take their own row under the speed and the readouts.
Undo: restore the `#transport` markup, its CSS and the `rateBtn` handler in web/index.html from before this PR.

**Roadmap 2 item 16: the Limit sign (U-40).** The Limit readout is the white US sign in Roadbook, Tapedeck and Billet
alike (theme contract 4.3.5): 44 x 52, a black edge with the sign's inset rule, SPEED LIMIT in small caps over the
number in Barlow Condensed. No theme restyles it. My calls:
- *Unknown, it is the same sign drawn in pencil with "--"*, not a blank box, so the shape is learnt before a limit shows.
- *The 13 px binnacle floor exempts the sign's legend*: it is part of the drawn sign; its number (20 px) is what's read.
  The e2e theme contract now checks the sign is white and 44 x 52 in every theme, day and night.
Undo: the `.ro-limit` block in index.html.

**Roadmap 2 item 15: placeholders and small words (U-34, U-41, U-42).** My calls:
- *An unknown score is "--" in the numeral font, in pencil*, on the Log hero and rows, the drive page, stages, Compare
  and the drive-ended card; it was drawn as two black bars that read as a redaction.
- *"1,240 points" is gone from the Garage*: no unit said what it counted (the last trace of Octane).
- *Works stickers carry the supporter's initial*, tilted, in the crew's colours; the count stays in the line above.
  Nothing to count yet: "Plain livery · Decals come from crew-mates with Vetta Pro" as one pencil line, no box, no
  empty gauge. "Take them off" sits left, in pencil. The crew's meta line is 13 px so it fits.
- *The route card's links in two weights*: Save and Share in ink, Share ETA, GPX and Pin place in pencil.
- *One back glyph*: a friend's profile goes back with "‹ Friends" ("‹" everywhere, named for where it goes).
Undo: `.unk` and `UNK` (analysis.html, drive_view.js, index.html), `liveryBox` in crew_page.js.

**Roadmap 2 item 14: the Log is the drive list (U-32, U-33).** My calls:
- *One summary row under the hero*: "2026 · 35 mi · 4 drives · 1 of 3 challenges"; open it for the year's lines,
  Share and this month's challenges. The year line and the challenge line were two rows.
- *Your week heads the drive list* when the week has drives; the rest of the Log stays quiet lines below it.
- *Empty states are one line with the action*: "No drives yet. Start one on the map, or watch a replay." and "No
  stages yet. Mark a stretch you drive often from a drive's page: your drives." No boxes.
- *A stage is marked from a drive*: the drive page gets Mark a stage (as the drive-ended card has); the Stages tab
  lost its "New stage" key and only shows the marker when you arrive from a drive.
Undo: the Log markup and `summaryParts` in analysis.html.

**Roadmap 2 item 13: in a crew, its page is the Crew tab; the old list is its settings (U-30).** My calls:
- *The header is the crew*: its switcher (or its name), and a gear key that opens Crew settings: your crews with their
  members, shares, invite links, public or private and Leave; create another; crews near you. The "Crew" title is gone.
- *Routes shared with you, Spots near you and Crew drives are rows on the page* that open their lists; the routes row
  shows how many. Plan a drive stays the crew page's "No drive planned" card and the Crew drives list.
- *Not in a crew yet, nothing moves*: the list is the tab, since it is how you join or make one.
- *A crew invite you opened a link for opens the settings sheet*, where the Join card is.
Undo: `inCrew` in renderAccount (index.html).

**Roadmap 2 item 12: the browser's own controls are gone from the drive page, Stages and Compare (U-18).** My calls:
- *A list choice is a row and a sheet of rows* (`web/row_select.js`): the chosen option with a chevron; tap it for a
  sheet, the chosen row marked in red. The `<select>` stays underneath, hidden, so nothing that reads it changed. Used
  for the Stages drive picker, Compare's two drives (now stacked, Swap beside them) and "share a stage with".
- *Dashcam overlay is a ruled section*: "Pick a video" is an ink key over the hidden file input; the offset is the
  balance slider from the plan sheet (Earlier / Later), whose style moved to controls.css so both pages share it.
- *The other selects (car details, build steps, crew drive roles, the crash reason) keep the browser's for now*: they
  are on forms the next items rework (crew settings, the event sheet); `ApexRowSelect.enhance` is one line each.
Undo: drop the `ApexRowSelect.enhance` calls.

**Roadmap 2 item 11: the plan sheet has one loop control (U-31).** The dial is the control: the five lengths sit as
ticks around it (tap one, or turn the dial and it clicks to the nearest), the value in its face. My calls:
- *The detent chips and both helper sentences are gone.* The Roads keys carry their sentence as a description
  (title and screen reader), not as prose under them.
- *On its side the dial stays* (it was hidden there); the loop spans the left column and Roads, More and Find a loop
  stack on the right.
- *Start from is a row with the ink pin*, like a recent place, and edits in place.
Undo: the `.loop-gauge` block and `#loopGauge` markup in index.html.

**Roadmap 2 item 10: one slide switch (U-44).** Every on/off setting (Layers, Garage, Friends, a friend's and a crew's
Scores and Times, Share road feel) is the same switch: a 44 x 24 track, a 20 px thumb that travels 20 px with a 2 px drop;
off is a pencil thumb on paper, on is an ink track. My calls:
- *No red in a switch or a value*: "Notes Auto" and the like are ink. Red stays record and destructive.
- *Night is a three-position switch in the Garage* (Auto / Day / Night) instead of a value that cycles. Notes keeps its
  cycling row for now (its three values have words of their own in Layers).
- *The drive page's Speed / Smoothness map colour is the mode switch*, not two boxes.
Undo: the `.sw` block in index.html, `switchRow`, `#nightSwitch`.

**Roadmap 2 (docs/design/REVIEW2.md 5), the leftovers of items 2, 4, 6 and 7.** My calls:
- *Privacy, Terms and Licences use the app's Roadbook paper, ink and Inter Tight*, with a "‹ Garage" row and the draft
  notice as an ink rule (U-26). The words are unchanged. The `?view=garage` link they use now opens the Garage (it was
  ignored). Undo: web/legal.css from git.
- *About is a section in the Garage* (version, the four promises); the landing page stays on the website. The version
  comes from the iOS shell's user agent (`ApexNav/1.0 (12)`); the website shows "Website".
- *The Log page gets the right-hand tab rail on its side*, like the other tabs (U-27).
- *A Pro theme on trial says so in a status plate next to the replay plate* ("Tapedeck · 9:40 left · Stop"), not a
  toast over the hazard plate's place (U-39).
- *The safe-area e2e flow also fails on overlapping keys and on text or keys under 8 pt from an edge the insets don't
  cover*, checks its own scanner on planted faults first, and waits for the opening cover to lift: until now it had been
  scanning the cover on most screens. CI keeps one contact sheet per phone shape (`safe-area-contact-sheets`).

**The voices: one voice per drive, every clip heard right, one loudness.** You said the voices were messed up in the app
and on the website. What I found, by transcribing every clip with Whisper and measuring them: Marguerite (`bf_isabella`)
added a syllable to short calls ("Left four plus-es", "Crest-ed"), 103 of her clips misheard; Kit had 89 and Hale 32
(mostly "care" said unclearly); the packs differed by up to 5.5 dB and clips inside a pack by more; every line that
wasn't a pace note (directions, rerouting, traffic, reported hazards, coaching) went to the phone's own voice, so a
drive kept switching voices; and on iOS, playback after a call or Siri started on a suspended audio context and ended on
a timer, so calls were cut off or silent. My calls:
- *Marguerite is Kokoro `af_bella`*, an American voice: every British female Kokoro voice has the same trailing
  syllable, and she was the only one to say all fifteen test calls clean. Undo: `kokoro_voice` in tools/voicebank.py,
  then `--rebuild-checked`.
- *Directions, route, traffic, reported-hazard, coaching, break, regroup and track lines are in each pack*
  (`web/voice_lines.js`). A street name isn't: the fixed part plays in the pack's voice and the name stays on screen
  (on the website with the live voice loaded, the whole sentence is rendered in the pack's voice). Undo: drop `tokens`
  from `say()` calls.
- *The convoy lines with a friend's handle stay on the phone's voice* for now; they can't be pre-rendered.
- *The replay's play button no longer says the drive's name*: it was the one line always in the phone's voice.
- *Every clip is levelled to -20 dB RMS*, peaks at 0.89. Undo: `TARGET_RMS_DB` in tools/voicebank.py and `--relevel`.
- *Clips are rendered up to six times (three spellings, at the voice's speed and 12 % slower) and the take Whisper hears
  best is kept* (`--rebuild-checked`); the manifest records the score. Still under 0.8 after that: Marguerite 56 of 841,
  Kit 82 and Hale 39 of the clips re-checked. Most are the recogniser, not the voice ("Acute" heard as "a cute", "four
  fifty" as "for 50", a bare "and" as "End").
- *Kit's tens were a real fault*: at his speed "forty", "fifty", "sixty" and "eighty" were heard as fourteen to
  eighteen by two Whisper models, a wrong distance in a call. His tens are now rendered at 0.9 speed (eighty with the
  American pronunciation rules); `TOKEN_OVERRIDES` in tools/voicebank.py keeps that for future rebuilds. Hale's bare
  "sixty" is heard as "six day": not a teen, so it stays. Undo: empty `TOKEN_OVERRIDES` and rebuild those clips.

**The Dynamic Island, corners and home bar, second pass (docs/design/REVIEW2.md).** You said it wasn't fixed everywhere;
a second Fable review with docs/IDEAS.md and the screenshots found 22 places. All are fixed except where noted there,
and the e2e "safe areas" flow now checks 14 screens on four devices (15 Pro upright and on its side, mini on its side,
SE), with no exemption for scrolled content inside a sheet. My calls:
- *On its side, the Layers panel opens from the top of the map*, below the island's row, not mid-screen.
- *On its side, the plan sheet is two columns and drops the loop dial* (the loop length stays as the chips); it didn't fit.
- *On its side, onboarding, the hazard report, the drive-ended card and the Tapedeck cluster use two or three columns*.
- *The photo viewer is a black full-screen lightbox* inside the safe areas, not a card.
- *While a sheet or overlay is open, the tab bar and the map's edge keys hide* so nothing shows through the dim.
- *The Live Activity follows Apple's Dynamic Island layout*: distance leading, arrival trailing, the call and note
  below; compact shows the distance and a short call, minimal an arrow or a hazard triangle, and the island's keyline
  goes orange for a hazard. Undo: LiveActivity/ApexLiveWidget.swift.
- *The shared arrival page says "isn't known yet" and `--`* instead of NaN when the time can't be read.
- *The e2e job's timeout is 15 minutes*: the safe-area flow takes about 3.5.

**Nothing you read or tap sits under the Dynamic Island, the home indicator or the rounded corners, upright or on
its side.** The app draws edge to edge (`contentInsetAdjustmentBehavior = .never`), so the page owns the safe areas. A new
e2e flow ("safe areas") emulates an iPhone 15 Pro's insets in both orientations and fails on any control or text in
them; upright was already clean, on its side was not. My calls:
- *The map and the panels' backgrounds still run edge to edge*; only content is inset (`--safe-left`, `--safe-right`
  join `--safe-top` and `--safe-bottom`). Scrolling content may pass under the home indicator, as on iOS.
- *On its side the tab rail widens by the inset*; sheets, the plan deck, the plates, overlays, the build thread, the
  report and crash sheets and the Log pad by it.
- *On its side the suggested loop floats over the map above the deck*: it was crushed into the tab rail.
- *Bottom sheets sit on an auto margin, not flex-end*, so a sheet taller than a landscape screen scrolls to its top
  (the hazard report's title was cut off).
Undo: the `env(safe-area-inset-*)` paddings in index.html, analysis.html, controls.css, builds.js, incident.js and
safety_ui.js.

**A fresh pass over REVIEW.md 1.2, screen by screen, now an e2e check; five gaps fixed.** Two flows in `e2e/smoke.js`
("REVIEW.md 1.2 screen by screen") walk every row on the running app and assert what the review asked for. My calls:
- *Recenter is the second map key under Layers*, a crosshair (the mockup), with the seconds until it recenters on its
  own in place of the glyph. It was a text plate bottom-left. Undo: restore `<button class="plate" id="recenterBtn">`.
- *Destructive actions ask on Vetta's own confirm sheet* (`web/confirm.js`): red action text, Cancel focused and the
  default (Escape, a tap outside). All 19 system `confirm()` boxes are gone; `tests/test_confirm_sheet.py` keeps them out.
  Undo: `ApexConfirm.ask(text)` back to `confirm(text)`.
- *The rest of the Log is quiet lines*: Your week, Your roads and Kudos fold like the year and challenges; only the
  drive list keeps a border. Undo: the three `<details class="quiet">` back to `<div class="panel">` with an h2.
- *Drive detail fits the phone*: a grid column grew past the screen for one wide child (the Score bars); grid columns are
  now `minmax(0, 1fr)`. Not a call, a bug.
- *Signed-out Crew promises Friends on the map, the board and crew drives* (the review's three), not Convoys.

**Followed-build notifications are decided in ApexKit, and a flaky profile test is fixed.** My calls:
- *Which builds get a notification, and its words, moved to `ApexKit/Sources/ApexKit/BuildAlerts.swift`* with unit tests
  (`BuildAlertsTests.swift`) that CI runs on Linux and macOS for every PR; `ApexBuildNotifier.swift` keeps only the iOS
  calls (background refresh, permission, posting). Undo: move `due`/`words` back into the notifier.
- *`profile.test.ts` no longer fails at random*: it checked the profile JSON never contained "600" (the hidden time),
  but random car ids sometimes do. It now checks for the value `:600`. Undo: revert the one line.

**The binnacle shows the live Vetta Score (REVIEW.md 1.2 Driving, 4.3), and a last pass over the 1.2 screen list.** My calls:
- *The Score sits under the meter in every theme* (speed left, Limit centre, Score right): the drive so far, scored the way
  the end card scores it, every 30 s while recording; "--" until there are enough clean corners, and on a replay. The
  meter shrinks to make room; Billet's bezel rounds the meter only; the g-ball's BANK text grew so it stays over 13 px.
- *Onboarding's one button says Start* (REVIEW.md 1.2, Onboarding 1); Watch a replay stays as a text link, since it's how
  someone without a car (an App Store reviewer) sees the product.
- *The Log's empty states point to Garage, Your data for import*, where import moved in phase 2.
- Checked and already in place from phases 1-2: the place plate, Layers key, plan basic/More, route card dials (Twist,
  Flow, Surface, Cameras), the hazard-style report buttons and CREST/DIP pins, the drive-ended card, the Log hero and
  index, drive detail, Stages in Log, the Crew signed-out line, red destructive actions behind a confirm.

**No toast repeats the route bar (REVIEW.md 1.2, Route bar).** A planned route no longer toasts its name, length and fun
score; the bar and the card say them. A loop toasts only when it couldn't match what you asked ("the closest good loop
to 45 mi"). Undo: the two toasts are in git history.

**The livery tiers' extras (REVIEW.md 5.1), dormant until Pro ships like the tiers themselves.** My calls:
- *Club*: the owner pins one chat message; the crew keeps 3 event templates (the owner keeps one when planning a drive;
  anyone planning picks one to fill the form).
- *Works*: member badges (owner-set, 16 characters, shown on the board), a house stage with its own board (a stage shared
  with the crew), a convoy call sign that names the crew's convoys ("RIDGE · Dawn run"), 10 templates.
- *Factory*: the crest draws itself in the theme's accent (still with reduced motion), the crew page as a share card
  (crest, name, motto, tier, members, next drive; no photos, nobody's position), and up to four crew hazard categories
  ("Cattle grid"). *A crew's category is read only by its members*; everyone else's plate says Debris, so a label typed
  by one crew's owner never reaches strangers.
- *The crew's regroup line* (Factory) is rendered on the website, where the same Kokoro voices as the packs already run in
  the browser, once per pack, and uploaded as WAV; the app only plays audio (App Store 2.5.2 allows that). Verified: Kit's
  voice renders "Ridge Runners, regroup." as a 2.3 s, 112 KB clip in about 15 s. A convoy is the crew's when its name
  starts with the crew's call sign or name (crew drives name their convoys that way now). Every regroup call is now spoken
  to the convoy ("Regroup at the overlook."); before, it was only drawn. Migration 0039 is applied to both D1 databases.
- *Notifications for builds you follow come without APNs*: a background app refresh (iOS picks the time, every few hours
  at best) checks for new steps and posts a local notification. Permission is asked on Follow. The OWNER_TODO APNs row is
  gone. Undo: drop ApexBuildNotifier.swift and the fetch background mode.
- Migrations 0037 and 0038 are applied to both D1 databases.

**The end of a drive speaks, and the plan sheet gets its Prefer stamps (REVIEW.md 4.4, 3.3).** My calls:
- *Each pack closes in its own words around the Vetta Score* ("That's the drive. Score seven hundred two, your best on
  this road." / "Seven hundred two. Best yet on this road. That's a wrap." / "Complete. Score, seven hundred two."). The
  score is spoken from number clips rendered in each pack's voice, never from a second voice. Before this, nothing was
  said at the end of a drive.
- *"Your best on this road"* means better than every earlier drive in your Log named after the same road, and it needs at
  least one; a first drive or a tie isn't a best. It shows on the end card too.
- *Kit's review line "Told you late out works"* isn't used: it would claim coaching the app didn't give. His close is
  "That's a wrap."
- *Prefer (Measured roads, New to me, Crew favourites) ranks the router's candidates* rather than steering the router,
  which can't take them: up to six fun points each for the share of a route that members measured, that you haven't
  driven (your Log, on the phone) or that your crews shared. Presets keep them.

**Friends on the map (REVIEW.md 5.4, roadmap 24).** My calls:
- *Defaults as the review set them*: the layer off, Show me to Nobody, a 10-minute delay, within a mile, only while
  driving. The first time you turn the layer on, the sheet explains that seeing isn't sharing.
- *The delay is applied on the server*: a viewer gets your newest position that is at least that old, never a newer one,
  and positions older than the delay plus 30 minutes aren't shown at all. The server keeps only what the delay needs.
- *"Within a mile" is snapped to a fixed grid before it's stored*, so the exact point never reaches the database and
  repeated reads can't be averaged back. Switching from Exact to within a mile deletes what was stored.
- *Home zones go to the server while you're shown*, so it can refuse a position inside one even if the phone slipped;
  choosing Nobody deletes them. This changes "zones never leave the phone"; the privacy policy says so now. Undo: drop the
  zones from the settings call; the phone's own check stays.
- *The road name appears only for Live and Exact* ("Driving · Cherohala Skyway"); every other tag says how old and how
  rough. Migration 0035 is applied to both D1 databases.

**Build threads (REVIEW.md 5.3, roadmap 23).** My calls:
- *A build is seen by whoever sees the car*: its owner, and friends and private-crew mates when the car is shown. Hiding
  the car hides the thread. Builds show on your car card, a friend's car card and the crew page's Builds row.
- *A step's Vetta Score comes only from a drive in your Log* (picked from a list), never typed in, so it's evidence.
- *Following lists new steps* ("Builds you follow" in the Garage, "2 new") instead of a notification: the app has no push
  service yet. Notifications come when it does. Migration 0034 is applied to both D1 databases.
- *A step holds up to eight photos*, added after it's posted. Deleting a step deletes its photos and replies.
- *The per-thread chat (REVIEW.md 5.3)* is folded under the steps ("Chat · kept 30 days") so the log stays the thread;
  it shares the replies' 30-an-hour cap. Migration 0036 is applied to both D1 databases.

**Decals and livery tiers (REVIEW.md 5.1, roadmap 22), built but dormant.** My calls:
- *The server counts Pro only from `pro_entitlements`*, which nothing writes yet: StoreKit's App Store Server Notifications
  will (with the founders' grant and earned Pro). So every crew is Plain today and the livery box says where Decals come
  from. Migration 0033 is applied to both D1 databases.
- *A Pro member's Decals go to every crew they're in* (1, then 2, then 3 from the third month of continuous Pro), unless
  they keep them off one ("Take them off"). The review's "placed on a crew" became automatic with an opt-out, so nobody
  has to manage them.
- *Built now*: Club (5) unlocks a second stripe colour, a pinned route (kept past the usual 30-day route expiry while
  pinned) and a crest photo; Works (12) a third colour and five stripe patterns. Gates are on the Worker. A crew that
  drops a tier falls back to the look it still has, and gets the rest back when it climbs again.
- *Postponed, not dropped* (they need parts that don't exist yet): Club's chat pins and event templates; Works' member
  badges, house stage, convoy call sign and templates; all of Factory (animated crest, crew voice line, crew page in the
  share card, custom hazard categories). They come after build threads and friends on the map.

**Crew drives get roles, regroup points and a morning reminder (REVIEW.md roadmap 21).** My calls:
- *Two roles, lead and sweep.* The planner leads unless they name someone; the sweep is named at planning or taken later
  by anyone in the crew ("I'll sweep"), which also marks them going. Saying you're not going frees your role. The planner
  or the crew's owner can clear a role. Migration 0032 is applied to both D1 databases.
- *Up to five named regroup points*, set at the map's centre in the plan form; each one is a Directions link on the card.
- *The morning reminder replaces the loop invitation on the idle map* (one invitation at a time) from 4 AM on the day of a
  drive you said you're going to, until an hour after it starts. It shows the time, the meeting point, how many are going
  and the roles; Go routes to the meeting point. It's never shown while driving.
- *The plan form stays in Crew drives* rather than a new sheet built from the plan sheet: it already takes the route you
  planned on the map, and the crew page's "Plan a drive" opens it for that crew.
- *Tapping Going or Share on the crew page redraws only that part*, so a half-typed chat message isn't lost.

**The crew page (REVIEW.md roadmap 20).** The Crew tab opens your crew (a row of names to switch when you're in several). My calls:
- *Plain livery only*: the owner sets a motto, one of six drawn stock crests (Apex, Peak, Tulip, Wheel, Wing, Crown) and one
  of eight stripe colours, and adds a cover photo. Crest uploads and the higher tiers wait for Decals (roadmap 22). Migration
  0031 (the stock crest column) is applied to both D1 databases.
- *The board is the Vetta Score only*, best this month as each member published it to the crew; members who don't share
  show `--`. A member's car is named only in a private crew, where crew-mates already see shown cars.
- *Crew chat is kept 30 days*, plain text, 500 characters, 30 messages an hour a person. The author or the crew's owner
  deletes; three reports hide a message, a moderator's remove deletes it.
- *The old crew list stays below the page* (invite links, public/private, members, leave, create) until those move into
  the page's own settings.

**Photos (REVIEW.md roadmap 19, 5.2): a profile photo and a car's cover and gallery.** My calls:
- *Photos are kept in Workers KV, not R2,* because R2 isn't turned on for the account (only you can: OWNER_TODO). I
  made two KV namespaces (PHOTOS, prod and preview) and bound them. Undo: once R2 is on, move the bytes and change the
  binding in wrangler.jsonc; the D1 rows don't change.
- *Migration 0030 is applied to both D1 databases* (photos, the crew page's columns, crew chat, build threads), ahead of
  the screens that use them, so the next items don't need another migration.
- *Photos are re-encoded on the phone* (at most 1600 px, under 650 KB) and *the server strips every metadata segment
  again*: a photo never carries where it was taken. JPEG only.
- *Members only, both ways; one report hides a photo for 24 hours* while it's looked at, three keep it down (the same
  rule as everything else). The owner always sees their own.
- *Caps*: 12 photos a car (or crew, or post), 300 a person.
- *No photo appears on the map, the drive screen or the Log.* Faces and covers live in the Garage and Crew.

**Design phase 3 is built (REVIEW.md roadmap 15-18) and Start with no route calls the road you're on (3.1).** My calls:
- *Free drive follows the road you're on* from the map's own road lines, and calls corners as far as it can see; it never
  draws a route, never reroutes and never times anything. Leaving the road or losing GPS stops the calls.
- *Look and voice lives in the Garage.* Roadbook is free; Tapedeck and Billet are Pro. The `pro` flag stays off, so no one
  can buy them: a Pro theme can be tried for 10 minutes on the demo replay, and the card says Pro isn't on sale yet.
- *Each theme brings its voice; the voice list is gone* (the brief: "we will do away with custom voices"). Roadbook is
  Marguerite, Tapedeck is Kit, Billet is Hale (three British Kokoro voices, docs/VOICE.md). The
  device voice is the fallback when a pack isn't downloaded. The old voices (George, Daniel, Emma, Michael, Me, Jarvis)
  are deleted. Undo: they're in git history; tools/voicebank.py renders any Kokoro voice.
- *Key sounds are on by default, with a switch* ("Key sounds" under the words). The hazard two-tone is the same in every
  theme, so it always means the same thing.
- *Billet's needle is a spring*: it overshoots about 8% and settles, like a real gauge.

**Design phase 2 is built (REVIEW.md roadmap 9-14).** My calls inside it:
- *Notes and Voice are in the Garage and also under the Layers key.* The review moves them to the Garage, but the
  Garage can't be reached while driving (no tab bar), and muting the voice mid-drive has to stay one tap away.
- *Your handle, cars, road feel, account and blocked list moved to the Garage; Invite and Friends stay in Crew.*
- *The theme contract exempts the dial's printed scale numbers (0, 20, 40...) from the 13 px floor.* They are engraving,
  like a real gauge's; every readout (speed, Limit, Sight, trip, bank, labels) meets it. The speed numeral is now about
  41 px (it was about 22) and the dial is a little bigger to make room.
- *Long calls take another line rather than a smaller size* (the contract's 21 px floor).
- *The dial's dim engraving colour got darker* (day #9A9080 to #736A5A, night #6A6255 to #968C7B): it was 2.8:1, the
  contract asks 4.5:1.
- *Night keeps both calls in the strip* but drops the next call's modifiers, the second status line and unused lane
  arrows; the map's casings, labels and contours are dimmer.
- *The Log keeps its deeper panels (week, roads, trend, records) below the drive list* rather than removing them.

**Design phase 1 is built (docs/design/REVIEW.md roadmap 1-8).** My calls inside it:
- *The hazard plate never names who reported a hazard.* The mockup says "reported by @sam"; reports are anonymous today
  and naming people would be a privacy change, so the plate says what, how far, how old and how many confirmed. Undo:
  hazard_reports.js `plate()` (the server would also have to send handles).
- *Bump, crest and dip are hazards; plate cameras are not.* They get the black-and-orange plate on the map and in the
  notes strip; cameras keep the quiet style. Undo: `HAZARD_TYPES` in web/instruments.js and the `.pin` CSS.
- *The loop button says "Find a loop", not "Find roads".* It builds a loop; "Find roads" sounded like Explore. Undo: one
  label in web/index.html.
- *No "Prefer" stamps (measured roads, new to me, crew favourites) yet.* The router can't do them, and a control that
  does nothing breaks "the shape says what it does". They come when routing supports them.
- *Explore moved into More.* Loop and Explore did the same job on the basic level (the review's point); Loop stays up front.
- *The drive-ended card has no "best on this road" line yet,* only the one thing to work on: comparing with older drives
  on the same road needs the Log's matching, which the cockpit doesn't load. Next round.
- *First run keeps "Get started" and the quiet "Watch a replay" link.* The review said one button; the replay is a link,
  not a button, and it is the quickest way to see the product.
- *Octane points stay on the server and on the crew board; only the Look shop is gone.* Nothing in the app sells them now.

**The score is the Vetta Score, and the app doesn't explain how it's worked out** (your call; done). "Driver Score" is now
"Vetta Score" everywhere you see it (Log, drive card, week and year summaries, profiles, About, privacy, the store listing
and marketing drafts). Gone: the "How Score works" note on the Log, the formula line under your records, and every
"technique, never speed" claim about the score. My call on top: the drive page still shows the four parts (Pace, Smooth,
Brakes, Rhythm) as bars, because they tell you what to work on without giving the recipe. Undo the bars: say so; undo
the name: one string per file in the PR.

**About's "Technique, never speed" promise is now "No races"** ("no speed or time leaderboards anywhere"), which is still
true now that the score is no longer described as speed-free.

**The design review lives in docs/design/** (review, 12 mockups with pictures, the brief, the screenshots it was based on
and the code that draws the mockups), with a README so GitHub shows the mockups. The names in it (Tapedeck, Billet,
Decals, the voice names) are the designer's; say if any should change before they reach the app.

**Lane guidance (IDEAS R-29) is in; junction pictures are not.** Lanes show from a mile before a junction and are spoken
only when they are one block on the left, right or middle ("use the right 2 lanes"); split lanes are left to the drawing so
the voice never says something confusing. Junction pictures need a paid map source, so they wait. Undo: drop
`turn_lanes: true` from the router request in web/index.html.

**CarPlay screenshots: scripting reaches CarPlay's home screen, not inside Vetta.** On GitHub's Mac the simulator's CarPlay
display opens and Vetta's icon is there (the CarPlay entitlement and scene work), but the runner ignores synthetic clicks,
so nothing opens the app (3 runs). The workflow stays (`carplay-shots.yml`) for the home screen. For the screenshots Apple's
form wants: on any Mac with Xcode, run the app in an iPhone simulator, then Simulator → I/O → External Displays → CarPlay,
tap Vetta, and on the phone search a place and tap Drive it; about 10 minutes.

**Sight keeps the alert-driver numbers (1.5 s reaction, 0.5 g braking), not AASHTO's design values (2.5 s, 0.35 g).**
Why: the formulas are the published highway-design ones; the inputs are for an alert driver who is following pace notes and
expects the road, and are documented with sources in docs/ROAD_INTELLIGENCE.md ("Where the numbers come from"). AASHTO's
values are built to cover nearly every driver in the rain and would make Sight about 20% lower (99 instead of 125 mph at the
cap). Undo: two constants in web/apex_core.js and core/road_dna.py (`REACTION_S`, `BRAKE_DECEL_MPS2`).

**Sight shows "Open" when nothing limits you** (your call; done). The 125 mph on highways was only the 400 m sight cap.

**Sight is the old road speed under a new name, uncapped** (your call; done). For App Review, the review notes should
describe it as "the speed you could stop from within what you can see". Red when you're above it.

**Every page opens behind a short cover** in the theme's colour with the mark (your idea; done), lifted when the map has
drawn, at most 2.5 s. The launch screen, the app background and the cover are all the same dark colour.

**CarPlay screenshots by script on GitHub's Mac** (you said try it): a workflow opens the simulator's CarPlay display and
screenshots it during a test drive. If GitHub's Mac refuses the scripting, the fallback is 10 minutes in Xcode on a Mac.

## 2026-10-28

**Single-pass roads: through roads show after one drive; short and residential roads still need two different people.**
Why: you said a road should count from one pass. A lane that leads to one house would show that person's drives, so roads
that might be someone's driveway still wait for a second person. Undo: `OPEN_CLASSES` and `OPEN_UNCLASSIFIED_M` in
backend/src/roads.ts.

**The coverage map shows how sure each road is, never how many drives.** Your guardrail.

**CarPlay built now, entitlement only in simulator builds.** Why: Apple wants it built before granting it; device builds
can't carry the entitlement until it's granted or signing fails. Known gap: if CarPlay launches the app cold, it can't plan
a route until the phone app has opened once (it says "Couldn't plan the route yet. Try again in a moment."; it never tells
the driver to pick up the phone).

**Keyboard: the iPhone app reports the keyboard height to the page and stops the page from sliding.** Why: your
screenshots; the web-only fix didn't work in the app. Checked on the real iOS keyboard in the simulator.

**Route options: a route that is both slower and less fun than another is never offered.**

**Pro prices are a proposal, not a call:** $5.99 a month, $39.99 a year, $99.99 lifetime, founders free. Money is yours to
decide (docs/OWNER_TODO.md, first row).

**Name: Vetta in everything you see; the code keeps ApexNav.** Why: renaming the bundle id would make it a different app to
Apple and break TestFlight. Users never see the code names.
