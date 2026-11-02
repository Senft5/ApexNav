# MR: Marcus Bell, the EV driver (Sonnet)

## First impressions

I sell software for a living and I drive a Model 3 Performance. The twisties on regen are the best part of my week, and the worst part is the arithmetic that comes with them: I leave home at 82%, a good loop is 90 miles, the nearest Supercharger is on the wrong side of the hill, and Sunday is 38 degrees. Every map app I own either ignores that (Google) or turns the drive into a spreadsheet (ABRP). Vetta is neither of those yet. It simply doesn't know I exist.

What I see is good. The route card (planning flow, 004-route-card) is the most honest planning screen I've used: 9.0 mi, 23 min, "+7 min for fun", 34 corners, an elevation profile, a forecast line, and dashed gauges with a dash where it doesn't know the surface. I trust an app that shows `--`. But the card tells me everything except the one thing I'm anxious about: will I get back. Climbs 482 ft in all, highest 939 ft: that is an energy number, and the app has it, but it stops at the feet. On the drive screen (guided-drive 020-driving) the bottom bar says "about 30 min left" and a clock time. It never says "about 6 kWh" or "you'll arrive with 41%". The planner has a fuel warning for 50+ mi stretches (IDEAS R-23 says EV chargers and the car's range are still to do), and that gap is exactly mine.

The drive-ended card (guided-drive 286) is clean and fast, but the road-feel bits are the same for a Civic or a Cybertruck. Nothing there knows a regen drive from a gas one.

I'll be fair: I don't want an EV mode that is a second app. I want three numbers and one stop suggestion, computed from data Vetta already holds (distance, elevation, speed, weather) and one number I type once: my car's range. Nothing here needs money or an account.

## Proposals

### MR-1: "Will I get back": an energy line on the route card
- **Why:** The route card (planning 004) already has distance, climb (482 ft), highest point and forecast. An EV driver's only planning question is arrival charge, and nothing answers it. R-23 lists this as to do.
- **Build:** A one-time "My car" entry (Garage): usable kWh, rated Wh/mi, optional starting charge, stored on the phone only. The route card gains one line under the forecast: "About 31 kWh round trip · arrive with about 38%". Compute with a simple, visibly rough model: rated Wh/mi x distance, plus climb (mass x g x gain, with a typical 60% regen recovery on the descents), plus a speed penalty above 65 mph and a cold-weather factor from the forecast already fetched. Show a range ("34 to 41%"), never a single false-precise number. Unknown inputs stay unknown: no car set means no line, a "Add your car" link instead. No assumed default car.
- **Cost:** M
- **Done looks like:** I set 75 kWh and 82% once. The route card for the Winton Woods loop says "arrive with about 70 to 74%". A 90-mile loop in the cold says 31 to 38%, in amber. A user with no car set sees no energy line and no invented numbers. A unit test pins the model against hand-worked climb examples.

### MR-2: A charge stop that's a good road, not a detour
- **Why:** The fuel warning exists for 50+ mi with no station. Chargers are the same problem with a different place. When the arrival number from MR-1 falls under my floor, the next question is where I stop, and on a pace-note app that should be a stop with a coffee or a view, not a parking lot on a highway.
- **Build:** When the estimate is under the user's floor (default 15%, adjustable), add a "Charge" suggestion on the route card: nearest chargers within 3 mi of the route from the same map data the fuel check uses (OSM `amenity=charging_station` carries `capacity` and `socket:*` tags, so DC fast vs slow can be shown when tagged and "unknown" when not). One tap adds it as a waypoint through the existing stage mechanism ("Mark a stage" already exists on the end card). Do not claim live availability or price; the data has none. Say "charger on the map, status unknown".
- **Cost:** M
- **Done looks like:** A planned 140-mile loop at 60% start shows "Charge before the climb: Kroger Supercharger, 2.1 mi off route, DC fast". Tapping it adds it as a stage and the re-route keeps the twisty section. A route with enough range shows no charge UI at all.

### MR-3: Drive screen and end card with the energy truth
- **Why:** The guided drive's bottom bar (020-driving) has a time remaining and a clock. Mid-drive I want one glanceable battery figure beside it, and on the End card (286) I want what the drive cost. P-01 (battery cost per drive) exists for the phone's battery, not the car's.
- **Build:** If the user entered a car, the status row's "about 30 min left" gets an "arrive 38%" suffix from the MR-1 model, recomputed from distance remaining. Vetta cannot read a Tesla's real charge without an account, so it stays an estimate and says "est." On the End card, one line: "Est. 6.2 kWh, 310 Wh/mi, regen about 18%". Add no new screen. Honour the 12 s total glance rule: the suffix only shows when notes are not mid-call.
- **Cost:** S (after MR-1)
- **Done looks like:** Drive 286 shows "Est. 310 Wh/mi" under the distance line. The drive bar reads "Rec 1.60 mi · arrive 38% est. · 11:21 PM". With no car set, both are unchanged from now.

### MR-4: Regen-aware call timing and "lift" notes
- **Why:** Driving an EV hard on regen, the brake call "Careful, tight right" means lift, not brake, and my car's deceleration on lift is large and one-pedal. A co-driver that says "Brake" at 60 gets a lift and a shorter distance than a gas car needs. Round 1's grammar work (warning word first) landed; this is a small extension of it.
- **Build:** A Garage setting "Drivetrain: gas / EV (one-pedal)". When EV, the approach call uses "Lift" in place of "Brake" for corner calls the speed model says regen alone can handle, and keeps "Brake" for hairpins and anything over a threshold. This changes the word, not the distance. Leave the timing as is until a real EV drive gives us a measured decel profile (we have none: say so in the code comment).
- **Cost:** S
- **Done looks like:** With EV selected, the Dry Ridge replay says "Lift, tight right" where gas says "Careful, tight right" only where the planned speed drop is under the regen threshold; hairpins still say "Brake". Gas users see no change. A transcript diff in the recording shows both.

## Did round 1 land?
Mostly yes for me: the route card is dense and honest, and the end card is fast with a one-tap Done. The "Your roads and a Sunday suggestion" work did not help me: nothing about a Sunday suggestion mentions that I can reach it and get home. Note the review rig showed no EV state at all, so I cannot judge anything EV from photos.

## What I'd protect
1. The dash for unknown values on the route gauges (SURFACE and CAMERAS, planning 004). Keep it for energy: no car set means no number.
2. Free forever with no account: an EV model that runs on a number I type once, on my phone, is the right shape. Don't put charge status behind a Tesla login.
