# Call sheet

Decisions Claude made for you, newest first. Each one says what was decided, why, and how to undo it. Read the top until
you reach one you've seen. If you disagree with a call, say so and it gets reversed; nothing here is hard to undo unless
it says so. Things only you can do are in docs/OWNER_TODO.md.

## 2026-10-29

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
