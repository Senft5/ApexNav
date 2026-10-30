# Call sheet

Decisions Claude made for you, newest first. Each one says what was decided, why, and how to undo it. Read the top until
you reach one you've seen. If you disagree with a call, say so and it gets reversed; nothing here is hard to undo unless
it says so. Things only you can do are in docs/OWNER_TODO.md.

## 2026-10-30: from your drive to work (CarPlay)

- *A drive is never lost again.* It was only saved on End; CarPlay's disconnect told the page nothing; a page iOS closed
  in the background lost the whole drive. Now it is checkpointed every 15 s or 250 m, the shell keeps its own journal of
  every fix until the page has it, a drive ends itself 20 s after the car disconnects (if it hasn't driven on: a
  wireless drop at speed doesn't split it) or after 10 min parked without CarPlay, and a drive never ended is recovered
  into the Log at the next launch, marked "Recovered". The walk from the car is cut off (below 2.5 m/s). Undo:
  `PARK_MS`, `CAR_GONE_MS` in web/drive_keep.js. **For you:** GPS still runs in the background after a drive (it did
  before); that's a battery question.
- *Turn-by-turn in road order* ("exit 19 in 0.1 mi", then "sharp right in 1 mile", then "exit 19"): one tracked turn
  for the voice and the car's card; a turn counts as taken 30 m past it and never comes back; each turn has three
  prompts (about 30 s, 12 s, 5 s out) said once each; no corner past a junction is read before the junction's last
  call. Undo: `TAKEN_M` and the ladder in web/directions.js.
- *The car map glides*: it moved once per fix and sat still between (91 to 98 % of frames had no motion); now it eases
  every frame to the newest fix, about one fix behind, never ahead of real data. Repeated messages do nothing; plates
  are placed at most 4 times a second; no contour lines in the car (hillshade kept); pixel ratio capped at 2; WebKit no
  longer throttles the car map with the phone locked. Undo: carmap.js `glide`; the contour block (parent of 52c98a8).
- *The phone stops redrawing when nothing moves*: the follow camera nudged the map by invisible amounts every frame,
  redrawing it 60 times a second standing still; now a move under a pixel is skipped, and the strip, gauges and scrubber
  are written only when they change. The font stylesheet no longer blocks start-up (a brief fallback font behind the
  cover). Idle map p50 frame 383 ms -> 16.7 ms at 4x CPU; People opens in 0.15 s (was 2.4 s). **For you:** hillshade and
  contours are now the main per-frame cost in a drive on the phone; turning them off in a drive would change the look.

## 2026-10-30: the Crew tab is People (your decision)

**Your design, built as you chose it** ("the crew tab is still laid out like shit with two places to invite people and a
mix of individual social features and group features in one area"). Four tabs still; the third is **People**. Its
header is a two-stop switch, **Friends | Crews**, the app's own `.switch` (like Notes and Night).
- *Friends* (where it opens): your friends first, one row each with their face, handle and where they are ("On the
  road · Cherohala Skyway", "Seen 15 min ago", or "Not sharing where they are"), read from what each one already shares
  with you on the map (`friendState` in web/friends_map.js; nothing is shown that they didn't share, and if the read fails
  the line is left blank, never guessed). A tap opens what you share with them, Profile, Unfriend, Report, Block. Then
  one key, **Invite or add a friend**: one sheet with Send an invite link (new to Vetta), Share my handle and Send
  request (already on Vetta), and the requests (incoming and the ones you sent). Then rows: Requests (count), Routes
  shared with you, Spots near you, Friends on the map (it says who sees you). The points board after them.
- *Crews*: in a crew, its page with the crew switcher and the settings gear (your crews' sharing, invite links, Leave),
  then rows for Crew drives, Crews near you and Start a crew, then Convoy and the crew standings. Not in one: Your crews,
  Crews near you, Start a crew, Crew drives, Convoy. A crew invite sits at the top of Crews; crew invite links stay in a
  crew (its page, its tile).
- *Signed out*, not a member, no handle yet: the same switch on both sides. Each side says what it gets you, then Sign
  in with Apple and Google; Crews says "Join with an invite" or "Pick a handle" with a key back to Friends.
- *Links*: `?add=` opens Friends with the Invite sheet and the handle filled in; `?invite=` Friends; `?crew=` and a convoy
  invite open Crews; `?view=crew` (old links, the review recording) is an alias for People on its Crews side,
  `?view=people` and `?view=friends` work too. The Log's tab bar says People.

My calls on the way:
- *The switch is the sheet's header*, not a "People" title over a switch (the title stays for screen readers): it stays
  put while you scroll, and the tab already says People. Undo: the `.sheet[data-view="people"]` rules in web/index.html.
- *The tab icon is unchanged* (two people, like Apple's person.2): it already reads as People.
- *Moderator tools* (errors, health, latency, feedback, the moderation queue) sit at the bottom of Friends.
- *Fixed on the way*: the page's `el()` helper dropped `aria-label`/`aria-hidden` (Object.assign sets properties, and
  those are attributes), so the crew gear and four inputs had no accessible name; it now sets them as attributes.
  Undo: the `el` line in web/index.html.
- "Sign in (Crew)" and "in Crew" in toasts now say People; "Road data in Crew" now says Share road feel in the Garage
  (where that switch has been since REVIEW.md roadmap 9).

## 2026-10-30 (morning): Review 4, stage 2

**Fable's check (docs/design/REVIEW4_CHECK.md): 26 of 32 fixed, and 16 new findings (U-90 to U-105), all built.** Four
builders in parallel, merged into one PR. My calls, and theirs:
- *A route that uses its own road twice* (U-90, the one P0: "Back on route" 140 times in 36 s, then "Wrong way" for
  seven minutes): the match keeps route points within 40 m whose direction agrees with the heading, then takes the one
  nearest the progress so far; "Wrong way" must hold 5 s and ends on 3 good fixes; "Back on route" is said once per
  episode, at most once a minute. One consequence: a driver who U-turns early on an out-and-back is matched to the return
  leg (skips ahead) rather than told "Wrong way". Undo: `matchRoute` in web/reroute.js.
- *No call from inside a corner* (U-96): a corner closer than speed × (time to say it + 1.2 s) is skipped, not chained
  into the next call. *Distances in your units* (U-93): "then 400 feet" in miles. **For you:** the rally-style chain
  ("Left 3 into right 4, 120") still says bare metres, as rally notes do; feet would need new voice-pack recordings.
- *"careful" once per run of corners* (REVIEW4_CHECK §4), stronger cautions always. Undo: `createCareRun`.
- *One score* (U-91): the end card said "no score" because the recording it scored had no corners attached; the card,
  the live score, the Log and the Garage now all score through `ApexRecording.scoreOf` (the real drive: 673 on both).
- *The forecast, fitted to the one real drive* (U-97): it was 20 minutes optimistic; now 45.5 min against the real
  46.0. Back roads with no posted limit are capped at about 31 mph (14 m/s). Undo: the constants in web/eta.js.
- *The sight plate off posted limits* (U-60): OPEN above 80 mph and it stays OPEN until 10 mph under; a value holds 6 s
  before rising; a two-step fall shows at once.
- *A free drive on the car shows "--" for time and distance* (U-95). Unverified: Apple documents a negative time as
  "--", not a negative distance; if a real car shows "-1 mi", change the distance to 0 in `guideChanged`.
- *The island's words* (U-103): corner codes as the car map prints them ("R2", "RHP"), off route as "Wrong way".
- *Drive messages in the status line, not toasts over the map* (U-74, U-102), while the drive bar is up; toasts with a
  Cancel key stay toasts. *The end card's map is the whole drive* (U-88: MapLibre gave up fitting because the follow
  camera's padding was still on). *A stray GPS fix over 1 km away is a gap*, not a straight line filled with made-up
  road samples (it had drawn a 40 km road). Undo: `JUMP_M` in web/sensors.js.
- *Home by is a stepper* (U-98), *the route bar's name never cut* (U-101, "Details" is now the chevron alone), *a Done key
  on the replay* (U-104), *the launch lockup stays until the page paints* (U-80).
- *The review recording writes nothing real* (U-94): its hazard report reached production (deleted, docs/BACKUPS.md).
  In review mode the page, the shell (debug only) and the Worker (for the review account) hold every write. The car's
  video is stopped cleanly, the app log is the app's own lines, and one flow stops at a corner for U-86.

## 2026-10-30 (overnight): Review 4

**Review 4: Fable watched the real app, and all 32 findings were built overnight** (docs/design/REVIEW4.md, U-58 to U-89;
the prompts the owner approved are docs/design/REVIEW4_PROMPT.md). Five builders worked in parallel and Claude merged them
into one PR. Every finding is built; where a builder did it differently from Fable's suggestion, it's below. My calls:
- *The co-driver wakes on the road, not on the driver* (U-58): in Auto, notes come on for a corner ahead that is
  severity 3 or tighter, a hairpin, or one that needs braking, within max(2 × its lead, 800 m), as well as on the old
  g test. The first corner of a drive is called before the car moves, and going quiet and coming back are each said
  once (at most every 2 min). There's no "Notes on." clip in the voice packs, so coming back says the pack's "Full
  notes." (optional for the owner: record a "Notes on." line). A corner call now comes 1.5 s earlier at road speed
  (`THINK_S` in note_timing.js; the reaction learner counts from after it). Undo: `THINK_S = 0`; `wakes` in
  note_timing.js.
- *The quiet line names the road* (U-67): "Quiet · Circle Freeway · next corner 1.6 mi", using the map's road name
  (the name the saved drive gets) rather than its ref ("I-275"). An unknown road is left out of the line.
- *The sight plate holds still* (U-60): 5 mph steps rounded down (never more than you can stop within); it changes
  only when every reading for 2 s agrees, and goes red only after 3 s too fast. A plain "≥5 for 2 s" rule still
  flapped on the recording's numbers. **The Sight cell's red stays** (your theme contract); Fable's pushback on it is
  below for you.
- *GPX and loop routes get a time* (U-64): a forecast from the route's own speed envelope (0.92 × envelope, capped by
  the posted limit or 60 mph), shown as "1 h 05". It's the same kind of number a router's ETA is, not measured road
  data, and it's never called "with traffic". Share ETA now shows on those routes too. Undo: `timeFromEnvelope` in
  index.html.
- *The Live Activity*: "● QUIET" on a route, "● REC" in a free drive, "250 FT R2" with a note; no "--" or cut words.
- *The car is in every drive* (U-59, U-79, U-62, U-63): a free drive runs a CarPlay navigation session with a record
  card ("Recording · 4.2 mi driven") and End; the idle map has a Drive button, which also puts away a finished route
  the car isn't showing; after End the car goes idle. A corner over 2 km away becomes "Follow <road>" with the
  distance. If App Review objects to a session with no route, the fallback is End alone on the bar (docs/CARPLAY.md).
- *Every corner tulip redrawn* (U-78): the "pennant" in the recording was the R1 tulip, not the hairpin.
- *The welcome runs in the app* (U-65): it was switched off in the app since the first import, probably because the
  shell asked for location at launch on top of it. Location is now asked after the welcome's Start. The launch
  screen shows the Vetta lockup on Roadbook night's ink (U-80); a day theme still cuts from dark to light paper.
- *The route card opens when a route resolves* (U-70) with Drive it fixed at its foot; the recenter key never counts at
  you after an app move and shows only its glyph (U-71); a drive on a route is named after the route (U-75); a
  no-score end card's solid key is Open in the Log, with Share as a link.
- *The recording itself* (REVIEW4 §6): the guided and theme drives start a mile before Dry Ridge Rd's corners
  (`APEX_REPLAY_FROM`, 19.8 km), with photos every 3 s through them; themes are switched with Use and checked; the
  review account is signed in at launch, before the page loads. A run is now about 35–40 minutes. Undo: `TWISTIES`
  in UITests/ReviewFlows.swift.
- *Fable's pushback, for the owner to decide* (REVIEW4 §7): (1) the binnacle's Sight value red all the time vs the plate
  red only when too fast: Fable would make the cell ink so red means one thing. (2) Fable agrees corners are
  maneuvers only with the continue step (now built). Not changed without you.

## 2026-10-30

**The review account** (the owner: "yes make me the review account"). `@vetta_review`, a member with Share road feel off,
made directly in the database with no Google login behind it, so nobody can sign in as it except with its one session token
(a year long). That token went to the owner in chat to paste as the `REVIEW_SESSION` secret; it is not in the repository. It
is not friends with anyone or in any crew, so the signed-in recording shows an empty-but-real account rather than anyone's
data. Undo: delete user `7b39562f-72d8-4f6e-80c8-382820afb133` on `apexnav-db` (everything of it cascades).

**A review recording of every real-world flow, on demand** (docs/REVIEW_RECORDING.md). The owner asked for the whole app
captured in use for a deeper Fable review, run on demand only. My calls:
- *A real drive instead of fake sensors*: debug builds replay the bundled real drive (dry_ridge) through the shell's own
  GPS and motion handlers, its 100 Hz motion rebuilt from what it measured. It is test-only (`#if DEBUG`, guarded by
  tests/test_review_recording.py) and never reaches road data (the review account keeps sharing off).
- *A transcript instead of sound*: the page logs every line said in review mode; capturing audio on GitHub's Macs needs a
  virtual audio driver that is unproven there, so it's left out.
- *Eight flows as parallel jobs*, phone and car video plus a labelled photo per step, gathered into one `review-pack`.
- *Signed-in flows wait on the owner*: a review account's session must be a repository secret, which only the owner can add.
  Undo all of it: delete app-review.yml, UITests/ReviewFlows.swift, tools/review_pack.py and the `#if DEBUG` blocks.

**Loops get CarPlay guidance.** The first XCUITest run on the car's screen showed a loop's Drive start the drive on the
phone while the car stayed on its idle map: guidance needed turn-by-turn steps, which a loop (or a GPX track) doesn't
have, so its corners never reached the card. A route without steps now guides its corners (web/carplay.js).

**CarPlay screenshots by XCUITest.** Clicking the Simulator's CarPlay window from the Mac never reached the car (four
runs, only the home screen). UITests/CarPlayTests now opens Vetta through the CarPlay home screen's accessibility and
photographs the car's display, as tadasant/zimmer#1412 does on GitHub's runners.

## 2026-10-29

**Tapedeck's instruments a third of the height.** The owner: "the digital display part on the bottom took up most of
the screen" (313 px of an iPhone 15 Pro against Roadbook's 119). Upright on a phone, the bar meters now sit under Limit
and Sight beside the speed with the Score at their end, the bars are shorter, and Kit is a small fox (40 px on an upright phone, 80 elsewhere; REVIEW2.md U-38 had 80) beside his two-line call:
167 px, and the map gets the rest (457 px, was 311). Undo: the Tapedeck rules at the end of the `max-width: 480px`
block in web/index.html.

**Cameras load fast, and speed cameras join the plate readers.** The owner: "pull in police data from other sources and
figure out why the lpr data takes so long to load".
- *Why it was slow:* one Overpass query for the route's whole bounding box (a long diagonal route asked for a huge
  area), the three public servers tried one after another with no time limit (a busy one held everything for 25 s or
  more), a cache keyed to that exact box (no other route could use it), and "Avoid cameras" made every route wait on it
  before routing. Now (web/cameras.js): fixed 0.25° tiles, only those the route passes through, one query raced against
  all three servers (12 s limit each, the first answer wins), every tile kept a week, so a second route nearby is instant.
  Road closures (conditional tags) race the servers the same way.
- *Other sources:* speed cameras from OpenStreetMap (`highway=speed_camera`) now come with the plate readers, under the
  same Cameras switch, called "Speed camera" (they don't lower a road's Clear score, which is about plate readers).
  Live police only ever comes from drivers: members' Police reports already show and are spoken. Waze is out (no public
  feed, its terms forbid taking its reports); paid camera data is a licence, so it is in docs/OWNER_TODO.md.
  Undo: `fetchAlpr`/`alprNodesIn` back to the per-box query (git), or drop `highway=speed_camera` from `query()`.

**From the owner's phone photos: the convoy bar, Tapedeck in a drive, the plan sheet, a pin on the arrow.**
- *Convoy bar:* one line (name and status) off the right-hand keys; the leader's calls only in a drive, in one row that
  scrolls, instead of a two-row block over the map and the Layers key before any drive. Its socket host is now named in
  the CSP as `wss://` too: WebKit may not let `https:` cover `wss:`, which would leave the app on "Reconnecting…" while
  the browser tests pass. If it still reconnects on the phone after this, the next step is reading the Worker's convoy
  logs (needs the full Cloudflare connector, docs/BACKUPS.md 6a).
- *Tapedeck in a drive:* an unused leading digit shows nothing instead of a ghost 8 (a "7" read as "887"); the Night
  Trip key steps aside in a drive (the REC line has the distance); "Road: --" only shows where a route or a recorded
  drive has road types.
- *A loop gets no destination pin:* its end is its start, so the pin sat beside the car's arrow all drive.
- *The plan sheet closes when a drive starts*, with the keyboard.

**Full crew customization for the owner's account, and only a drive in progress survives a close.**
- *Livery grants.* The owner: "my account should have full access to crew customization". Pro comes only from
  `pro_entitlements` (nothing writes it before StoreKit), and one Pro member gives at most 3 Decals while the full livery
  (Factory) needs 20, so a Pro row would not do it. New table `livery_grants` (migration 0040): a crew with a granted
  member is Factory, every option open, and the granted user counts as Pro for their own Decals controls. Applied to
  preview and production through the connector with its `d1_migrations` row (docs/BACKUPS.md), and one row written:
  @natesenft. Undo: `DELETE FROM livery_grants WHERE user_id = '<id>'` (the table can stay).
- *Active routes, not planned ones, survive a close.* The owner liked a route coming back after the app closed, but
  only for a drive in progress. A route is kept (localStorage, 12 h) from the moment a drive on it starts, replaced on a
  reroute, and forgotten when the drive ends; opening the app back on it says so in a toast. A planned route still lasts
  the session only. Undo: `persistActive`/`forgetActive` in web/index.html.

**A drive clears the screen.** The owner: a drive started from the car while the phone showed the Crew sheet left the
sheet in the middle of the drive screen. Starting a drive now closes any sheet, its pop-ups and the Log frame, however
it was started (the car, Siri, a link or the button). Undo: the two lines at the top of `enterDrive`.

**The car map fills the screen at its own scale, and the app opens with no route.**
- *Edge to edge, at the car's scale.* The owner: "the map doesn't continue under the tiles and the tiles are giant". The
  web view kept the page inside the safe area, so the map stopped at the map buttons; and "device-width" in a web view
  is the iPhone's width, so the page was laid out about 390 wide and scaled up some 2.3 times (giant, soft plates and
  labels). The shell now sets no safe-area inset, `viewport-fit=cover`, and the car view's own width as the viewport
  (`fitViewport`). I missed both in the first photos.
- *No route on open.* The planned route was kept for 12 hours so a killed app came back to it; the owner doesn't want
  that ("it should open with no route loaded"). It now lasts the session only (a reload after a lost map still keeps
  it). Undo: `persistPlanned`/`restorePlanned` back to localStorage with `PLANNED_KEEP_MS`.

**Fixes from the owner's photos of build 498.1 in the car.**
- *The tulips are drawn straight onto a canvas* (Path2D from the SVG's own path data) instead of loading the SVG as an
  image first: the car showed Apple's stock arrow, so that load never finished in the app. Now the tulip rides on the
  first guide message. Undo: `tulipPNG` in web/index.html.
- *Distances in the driver's units on the car* ("70 m", "150 meter", "15,630 meter" for a driver in miles): the car prints
  a Measurement in the unit it is given, so the shell now converts (feet in 50s under a tenth of a mile, then miles to a
  tenth; metres in 10s, then km), from the units the page sends with the look. `ApexCar.distance`.
- *A loop's start is never read as its end.* With no recent match the whole route is searched, and a loop passes the
  same spot twice: the drive began "150 m" from the finish with an arrival in the past. Of the stretches within 40 m
  the one nearest the progress so far wins (`matchOnRoute`).
- *The trip card says each thing once*: one route's summary is its Fun score, else its corners (the title is the name and
  the car prints the time and length itself); several routes keep Fun and time to tell them apart.
- *Plates never pile up on the car's map*: a plate that would overlap one already shown hides (hazards first, then the
  corners nearest the car, or the tight ones in a preview), and the car's arrow and sight speed sit above every plate.

**The Log opens over the map, and the sight-line speed rides on the arrow.**
- *The Log is a frame over the map, never in its place.* The owner: "the crew page still does a full reload every time".
  Yesterday's fix sent the Log's tabs back in history, but it relied on the page's referrer (likely empty on the app's
  apexnav:// pages) and on WebKit keeping the map cached, so the map still loaded from scratch. Now the map page opens
  analysis.html in a full-screen iframe and never leaves: the Log's Map, Crew and Garage tabs just close the frame and
  open that tab. Side benefit: a drive and the car's screen keep running while you read the Log. The frame is kept and
  shown again as it was, and loaded fresh only after a new drive, a theme or units change, or for a different page of
  the Log. Its notch and home-bar insets come from the map page (env() is zero inside a frame), and its native calls
  (signed-in API, Save/Share) go through the map page's bridge, which the shell accepts as the main frame. A replay
  link from the Log still loads the map with that drive. Undo: `openLog` in web/index.html back to `location.href`.
- *Sight-line speed on the position arrow*, the owner's ask: a small plate under the arrow on the phone's map and the
  car's, with the speed you can stop within what you can see (the cluster's Sight cell), OPEN when nothing limits you,
  red when you are going faster than it, hidden when unknown. It is its own marker so it stays upright while the arrow
  turns. The car gets it only during a drive. Undo: `paintSight` in web/index.html and `drawSight` in web/carmap.js.

**Fixes after the first drive with CarPlay: switches, presses, reloads, Live Activities, corners on the car's card.**
- *Every corner is guidance in the car.* The owner: "if you take a R5 when you're supposed to take a RHP you're gonna have
  a bad time". The car's guidance card shows whichever comes first, the next turn or the next corner, at every rating,
  worded as the phone words it (the plain-words setting too), with a corner tulip (one smooth bend per rating, no
  junction dot, so it never reads as a turn onto another road). A corner within 40 m of a turn is the turn. Apple's
  guidelines ask CarPlay navigation apps for turn-by-turn guidance; a corner you must slow for is a maneuver, so I read
  this as inside them. Undo or fall back: `CAR_CORNERS` in web/index.html, `'tight'` (1, 2 and hairpins only, for if App
  Review objects) or `'off'` (turns alone). Noted in docs/APP_REVIEW.md.
- *The slide switch reads at a glance.* A 52 x 30 track; off is hollow (dim border, dim thumb left, an O mark); on is
  filled with ink (paper thumb right, an I mark). Two cues besides position. Undo: the `.sw i` rules in web/index.html.
- *Press feedback everywhere.* iOS only applies `:active` when the page has a touchstart listener, so nothing reacted
  to a finger; web/press.js adds an empty passive one and web/controls.css dims anything tappable while pressed (0.62)
  and drops the double-tap wait (`touch-action: manipulation`). Undo: remove press.js and the last rule in controls.css.
- *No page reloads for settings.* Units redraw in place (the dial, loop lengths, an open route card, Your data, offline
  areas; anything else picks them up when it next draws). App sign-in redraws the account instead of reloading. Erase
  everything still reloads (it is meant to start the page from nothing), and so does the map's WebGL recovery.
- *Log and Stages go back to the map.* They are their own page; their Map, Crew and Garage tabs now go back in history
  (web/page_return.js) when the map is the page behind, so WebKit's back-forward cache can return the map as you left
  it, and the tab you tapped opens there. If WebKit drops the cached page it loads as before. Moving the Log into the
  map page would remove this for good; it is a bigger change and I haven't made it.
- *Live Activities end with the drive.* Ending a drive now ends every one of ours, not only the one this launch started
  (a reload or relaunch forgot it, which is why it stuck); launch and quit end any left over; updates are marked stale
  two minutes on and resent once a minute, so a killed app shows an out-of-date card instead of a live-looking one.

**CarPlay, parts 2 and 3: our map, the road book and the full template set.** Built to the mockups the owner approved
(docs/design/carplay). My calls:
- *The car's map is a web page* (web/carmap.html in a WKWebView in the base view), sharing the phone's style, palettes,
  hill shading and contours (web/basemap.js), so the three themes look the same in the car with no second map engine. It
  draws only map content and takes no touches, which is what the guide asks of the base view.
- *Corner ratings and hazards are DOM plates near the car*, not every corner of a long route: the 40 nearest within about
  6 km while driving, up to 160 in a trip preview.
- *The guidance card takes the theme's night panel* in day and night alike, so the tulip (drawn in its ink) and Apple's
  white text read on it whatever the car's screen does.
- *Loops in the car are 30 minutes, 1 hour and 2 hours*; Explore stays on the phone (it is a list of roads to read).
- *Report in the car is the six fixed kinds*; a Factory crew's own categories stay on the phone.
- *Lane guidance is not in this build*: CPLaneGuidance needs per-maneuver lane data the page doesn't carry yet (CARPLAY.md 4).
Undo: revert CarPlay/ApexCarPlay.swift, web/carmap.*, web/basemap.js and the car wiring in web/index.html and web/carplay.js.

**CarPlay, part 1: the engine without the phone, and the pack's voice in the car.** The owner tried CarPlay: Apple Maps
under our route, SF arrows, and the system voice. Two causes, both ours. The cockpit page (the route engine) was made by
the phone's window, so a car that opened the app cold had nothing to plan with; now `ApexEngine` owns the page and the
sensor shell, whichever scene starts first makes them, and the phone's window shows the same page. And the voice packs
played through the page's WebAudio, which WebKit stops while the phone is locked (in its mount, in a car), so every line
fell to the device voice; now the shell plays the bank's clip files itself (`ApexClipPlayer`, `ApexVoice.nativePlay`).
My calls:
- *The car asks once and waits.* A place picked on the car's screen before the page has loaded is held and sent when it
  is ready, instead of the old "Couldn't plan the route yet" alert.
- *The theme follows the phone; day and night follow the car's screen; every corner rating is on the car's map;
  hazard reporting is one map button.* The owner left those four open; these are the defaults that change least.
Undo: revert ApexEngine and ApexClipPlayer (ApexNavApp.swift), `nativePlay` in web/voice.js.

**CarPlay granted: the entitlement in every build.** Apple assigned `com.apple.developer.carplay-maps` to the account.
`project.yml` now puts it in ApexNav.entitlements for device builds too; `CarPlay/Simulator.entitlements` (the
simulator-only stand-in) is gone. My calls:
- *The App Store Connect API can't switch it on*: I asked it to (POST bundleIdCapabilities, CARPLAY_NAVIGATION) and it
  answered that its 28 capability types hold no CarPlay; nothing changed. So the TestFlight run's cloud signing
  (`-allowProvisioningUpdates` with the API key) is what adds it to the App ID and the profile.
- *If that run fails to sign*, the fix is one tick in the portal: Identifiers → com.senft.ApexNav → CarPlay Navigation
  → Save (OWNER_TODO), then re-run the workflow.
Undo: drop the `com.apple.developer.carplay-maps` line from project.yml (device builds then sign without CarPlay).

**The fourth promise and open themes (owner, 2026-10-29).** The owner chose Fable's words with one change: "Free to drive.
No ads, no personal data sold, nothing you made ever behind a paywall" (About, the landing page, MARKETING.md and the
landing-page test). "Personal" matters: MONETIZATION.md 5 licenses anonymous road answers, never data about people,
so "no data sold" would not be true. And every theme is open to everyone until Vetta Pro goes on sale. My calls:
- *The switch is `THEMES_OPEN` in web/pro.js, and the `proOnSale` flag closes the themes by itself*, so the App Store
  release can't forget it; it is also in OWNER_TODO under "Before the first App Store submission".
- *Liveries stay Pro.* Only themes were asked for, and Decals come from verified Pro on the Worker.
- *The PRO tag stays on the two cards*: it is still true, and the picker now offers Use instead of Try it.
Undo: `THEMES_OPEN = false` in web/pro.js (and the early-access test in tests/test_pro.py); the promise's old words are
in git.

**Review 3 merged, with one correction.** Fable's branch replaced #252's Plan a drive, friend tag and tour scene with its
own (broader) versions; #252's unused checkbox switch and stepper rules came out of controls.css. My call: `noEmoji`
keeps the old text symbols that Unicode also files as pictographic (© ® ™ ‼, everything below U+2190), so a build
reply naming "Bilstein® B6" or a "© 2026" sticker reads as typed; arrows and emoji above it still go. Undo: drop the
callback in web/format.js `noEmoji` and the © case in tests/test_format.py.

**Review 3 (docs/design/REVIEW3.md): fixed in the branch, not only written up.** Fable had the code this time. My calls:
- *Plan a drive is the app's own form*: the crew, lead, sweep and template as row lists (web/row_select.js, now loaded by
  index.html too), the day as a strip of the next thirty stops and the time as a stepper in quarter hours (both new in
  controls.css), the yes/no choices as slide switches read through `.checked`, Going / Maybe / Can't as one switch. No
  calendar picker: the Worker takes a drive up to 30 days out, so thirty stops is the whole scale.
- *Every other select and checkbox the app drew is its own too* (Add a step, the car form, the report sheet, the livery
  editor, Feedback); a name is asked for on the confirm sheet (`ApexConfirm.prompt`), never the system's prompt box,
  and "Type DELETE" waits for the word. The clipboard fallback prompt on the website stays, as a last resort.
- *Red only for record and destructive, applied again*: the open Layers key, the Crew tab's count and the focus ring are
  ink; Remove a car, Leave a crew, Unfriend and Delete drives are red behind their confirm. The ring shows only after a
  Tab or arrow key (`html.kbd`), so a sheet's own focus() never draws one.
- *The lead call keeps its modifiers whole on a phone* (2fr to the lead note; Tapedeck's dot font may take a third
  line); Tapedeck's meters take their own row up to 480 px; the dial's 0 and top labels give way by day under 480 px.
- *A friend's tag swaps sides near the right edge*, and again after the map moves (friends_map.js `reflow`).
- *The tour's Tapedeck drive is a shell drive* (`?shell=1` fakes the shell, Start comes through the app link), so the
  still reads "Rec", which is what the app does; "Finding GPS…" was the tour feeding frames to a page with no drive.
- *Kept, after trying*: the unknown score "--" at 56 px is two bars in any face; the g-ball's BRAKE engraving names the
  direction the ball rolls under braking, the BANK readout is a different fact.
- *Toasts and the route card's corner ticks are ink*, not red: a message and information are neither record nor
  destructive. The camera toast says BRAND's line.
- *Not mine*: "No subscription." in About and on the landing page while Pro is planned as one (IDEAS U-48, owner).
Undo: the five commits named in REVIEW3.md §2, each on its own.
**The three defects the review stills found.** My calls:
- *Plan a drive uses only the app's controls.* Crew, template, lead and sweep are row pickers (web/row_select.js, now
  loaded on the map page too); the day and time are steppers (minus, value, plus; the day from today to 29 days out as
  the Worker allows, the time in 15-minute steps, holding a key keeps stepping); the yes-or-no lines are slide
  switches drawn on the checkbox itself, so the form's logic didn't change. Lead and sweep are stacked rows now.
- *A friend's label near the right edge goes on the face's left*, clear of the Layers key and the screen, and flips
  back as the map moves. The face stays on the friend's spot.
- *"Finding GPS..." on the live Tapedeck still was the tour's doing, not the app's.* The scene pushed shell frames
  without starting a drive, which no phone does (on iOS frames without a drive go to the idle map). A drive started
  by the shell's link reads "Rec 1.06 mi" with the same frames; the scene now starts one that way. The dark band under
  the map was a screenshot taken mid-resize; canvas and container measure the same. No app change for either.
Undo: revert web/crew_events.js, web/friends_map.js and the `.tick-sw`, `.stepper`, `.sw-row` rules in web/controls.css.

**Roadmap 2 item 20: stills of every mockup surface (U-37).** `node tools/app_tour.js route-card friends-map
plan-drive crew-board tapedeck-drive` saves OUT/stills/*.png: a routed mountain road with 186 corners, the profile
with its corner ticks, named legs and two alternatives; two friends (one late and fuzzed, one live on a road) and a
home zone; the Plan a drive form open; the crew board, next drive and chat; and Tapedeck on a live drive, not only a
replay. My calls:
- *The data is stubbed in the tour, never in the app*: the router, the place search and the Worker answer from the
  script, so nothing synthesized can reach a real driver (CLAUDE.md rule 3).
- *The stills show what is still wrong rather than staged around it*: the Plan a drive form still has the browser's
  selects, date and time pickers and checkboxes; a friend's label near the right edge slides under the Layers key; on
  the live Tapedeck drive the bar reads "Finding GPS..." with a good fix. They are in docs/STATE.md as the next work.
Undo: delete the five scenes and `still()` from tools/app_tour.js.
**Roadmap 2 item 19: night is a mode on the binnacle (U-36).** After dark (Auto, or Night in Settings) the binnacle
changes shape, not only colour: the speed numeral is 46 px on an SE dial and larger on bigger phones, and the 0 and top
labels at the foot of the dial give way to it; Limit and Sight keep their one row; the trip odometer steps aside for
a quiet Trip key that shows it for ten seconds. My calls:
- *A visible Trip key, not an invisible tap zone*, so the hidden readout is findable and VoiceOver can reach it.
- *On an iPhone SE upright, Limit sits over Sight, day and night.* The centre column there is 60 px and the two
  side by side spilled into the meter (it did on main too). Everywhere wider they share a row.
Undo: remove the `data-mode="night"` binnacle rules and the `.trip-peek` key (web/index.html, web/instruments.js).
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
