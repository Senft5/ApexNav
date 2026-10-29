# Call sheet

Decisions Claude made for you, newest first. Each one says what was decided, why, and how to undo it. Read the top until
you reach one you've seen. If you disagree with a call, say so and it gets reversed; nothing here is hard to undo unless
it says so. Things only you can do are in docs/OWNER_TODO.md.

## 2026-10-29

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
