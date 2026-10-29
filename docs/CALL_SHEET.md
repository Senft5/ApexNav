# Call sheet

Decisions Claude made for you, newest first. Each one says what was decided, why, and how to undo it. Read the top until
you reach one you've seen. If you disagree with a call, say so and it gets reversed; nothing here is hard to undo unless
it says so. Things only you can do are in docs/OWNER_TODO.md.

## 2026-10-29

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
