# Vetta: fourth review. The real app, watched in use

Reviewer: critic and automotive HMI hand, with the code open (read only).
Evidence: the review recording of 2026-10-30 (`scratchpad/r1/pack`: eight flows, 145 phone photos, 69 car photos,
ten videos, eight transcripts, eight app logs), an iPhone 16 Pro simulator with its CarPlay screen, replaying the real
Dry Ridge Rd drive through the app's own sensor handlers. Every path below is relative to the pack; a time like
`guided-drive/phone.mp4 @ 02:30` is a frame I pulled from that video. Where I read the code to find a cause I say so.
The two things to know before reading: the replayed drive spends its whole recorded length (about seven minutes per
flow) on Colerain Avenue and I-275, so no flow ever reached the corners the road is named for; and two flows (the themes
and the signed-in account) did not record what they were meant to, for reasons I give in §6. What was recorded is
still the most honest look at Vetta anyone has had, and it changes the picture the three still-image reviews painted.

---

## 1. The critique

### Opening it at the kerb

The first three seconds are not Vetta's. A 40-pixel route-mark sits alone on black (`first-run/phone.mp4 @ 01:00`,
`tabs/phone/01-map.png`), then, for two full seconds, a stranger's map: OpenFreeMap's "Liberty" style in daylight
white, with Burger King, Skyline Chili and blue parking Ps (`first-run/phone.mp4 @ 01:03.2` to `@ 01:05.2`). Then the
ink arrives and the stranger leaves. The cause is one line: `MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'`
is loaded and only afterwards restyled (`web/index.html:1552`, `restyleBasemap`). Halide never shows you a default
camera UI for two seconds; Vetta shows a default map. It is the first thing a new driver sees, and it says "web view"
before the app has said anything.

And then nothing welcomes you. The first-run flow's "opening" photo is the idle map (`first-run/phone/01-opening.png`).
There is no cover, no three-call strip, no voice, no "Start". The code has all of it (`runOnboarding`, the OB_NOTES loop
REVIEW2 asked for), but it is gated on `!window.APEX_EMBED` (`web/index.html:6492`), and the shell sets
`APEX_EMBED = true` at document start (`ApexNavApp.swift:287`). So the welcome runs on the website and never in the
app. `docs/APP_REVIEW.md` still says "first run is one screen with no sign-in". It is zero screens.

Once the ink is in, the idle map is the best screen in the app, and I want to be exact about why, so it is kept
(`first-run/phone/02-idle-map.png`). Hairline road casings in bone on near-black, contour lines you only notice when
you look, the place plate top-left in a paper box ("Colerain Township · Dry · 63°": place, sky, temperature, nothing
else), one search field, one red key with a dot that means record, and under it the single suggestion with its
hand-drawn tulip: "Loop from here · 45 mi". Four tabs, no badges. This is Dieter Rams's idle state: it does not sell
you anything, it waits. Two small faults. The subtitle "On the twistiest roads nearby · map only until driven" ends in
jargon a new driver cannot parse ("map only" means the road feel is estimated from the map until someone drives it;
nobody will know that). And when Layers opens, its panel lands on the place plate and cuts it to "Colerain Towns"
(`first-run/phone/03-layers.png`).

The Layers panel itself is right: six rows, the new switches read on and off at a glance (an I on the filled one, an O on
the hollow one), "Who sees me" as a link. One row is a hidden control: "Notes · Auto" cycles when tapped. The test's
stray tap at the centre of the screen hit it, the strip changed to "Notes · Full" (`first-run/phone.mp4 @ 01:06` to
`@ 01:12`) and the co-driver said "Full notes." (the whole of `first-run/transcript.txt`). A row that changes a mode on a
tap, with no detent and no chevron, is the one control on this screen that behaves like nothing else in the app.

### Planning a Sunday

Tap the field and the sheet rises with the keyboard (`planning/phone/01-where-to.png`): "Tap the map", "Or loop from
here · back where you started", the loop dial (15, 30, 45 mi, 1 h, 2 h, with a red needle at 45), Roads as a three-stop
detent (Quick · Fun · Max fun), "More: avoid, corner mix, explore, start point ›", and one bar, "Find a loop". It is the
basic level REVIEW.md asked for and it reads as a plan, not a form. Type "Winton Woods" and six rows come back fast
(`planning/phone/02-suggestions.png`). Here the first crack: the row gives the address half the line, so the place
is cut to "Winton Woods Middle S…" and "Winton Woods Golf Cou…" while "1231 W Kemper Rd, Cincinnati, …" is also cut.
Both halves lose; the name should win and the address drop to a second line in pencil.

The recording never shows a searched route card: the test's tap landed on the field, not the row (§6). What it shows
instead is the loop: thirty seconds later a bar appears at the foot of the map, "43 mi loop · 42.5 mi · 118 corners",
red Start, × (`planning/phone/09-loop.png`). That is all. The route card as instruments (three stamped numbers, the
profile with a tick per corner, the half-dials, the options as tiles: `web/route_card.js`, mockup 04) exists, but it is
behind a 36-pixel grabber nobody is told about. After the app has worked for half a minute on your behalf, it hands
you a one-line receipt. Things would open the project. Apple Maps shows the route card. This should rise to the
instruments and let Start sit on them.

While the loop is found the camera flies to fit it, and a square key appears under Layers whose entire face is "5s"
(`planning/phone/10-loop-1.png`, `11-loop-2.png`). It is the recenter key, counting down until it recenters on its own
(`recenterLeft`, `web/index.html:1975`). Nobody asked the map to move; the app moved it; and now a key is counting
at the user. The same key reads "2s" in the first seconds of every drive (`guided-drive/phone/02-drive-started.png`,
`free-drive/phone/02`, `tapedeck-night/phone/03`, `billet/phone/02`). A countdown should never be a key's face, and the
key should not appear after a camera move the app made itself.

### Starting the drive

The guided drive begins with the GPX route on the map (`guided-drive/phone/01-route-from-gpx.png`), a red ribbon
through black with a paper-ringed red dot at the start, and the collapsed bar: "Dry Ridge Rd · 35.4 mi · 32 corners ·
Start". No time, because a GPX carries none. Tap Start. The sheet closes, the tab bar leaves, and the drive screen
arrives all at once (`02-drive-started.png`): the strip on top, the map, one status line ("● Rec 0.01 mi · Report ·
End"), and the binnacle. The binnacle is the best thing Vetta has made and deserves its sentence: the dial with its
red hairline needle and the numeral inside it, the white Speed Limit sign (a real sign, as a sign should be), the Sight
cell, the g-ball with BRAKE engraved on its bezel and "BANK +0.0°" under it, and the Score in pencil. It is a gauge
cluster drawn by someone who has looked at one. Against Teenage Engineering it holds: every mark means something.

Then the strip. Its biggest word, at the top left of the screen, in the heaviest weight on the page, is "Clear". Next to
it, in 13-pixel grey: "Dry Ridge Rd · Quiet · bumps and cameras only". For the next six and a half minutes this does not
change (`guided-drive/phone/08` to `41`), except for ninety seconds of "Full notes" (`05` to `07`). The car is on I-275.
The strip says Dry Ridge Rd, which is the route's name, not the road; the binnacle's Road line says "--" the whole
drive; and when the drive ends the app names it "Circle Freeway" (`42-drive-ended.png`), which is I-275's name. So the
app knew the road all along and told the driver "--". The word "Clear" is the hazard plate's idle state and it is
honest, but as the loudest thing on a quiet screen it is a word about nothing. A road book in a quiet section does
not shout CLEAR; it shows the next instruction and how far. The app has that number: the car's card says the next
corner is 13.1 miles away. The strip should say it too: "Quiet · I-275 · next corner 13 mi".

### Being told "Tight right"

Now the call, and here I used the video. The drive starts at `guided-drive/phone.mp4 @ 02:24`. The strip reads "Clear
· Quiet". At `@ 02:26` the car turns out onto Colerain Avenue hard enough to pass 0.30 g, and at that instant the strip
discovers a corner: "550 FT · TIGHT RIGHT" (`@ 02:26` to `@ 02:29`, the ramp onto 275). The call itself, "Tight right",
is logged at 03:47:09, which the step photos place at about 250 ft and 36 to 39 mph (`guided-drive/phone/03-driving.png`,
`guided-drive/car/03-driving.png`): five seconds before the corner, while the driver was already braking (the dial reads
36, 32, 31, 28, 22, 17 on consecutive seconds, `@ 02:30` to `@ 02:35`). Then "0 FT" for ten seconds while the car waits
on the ramp (`@ 02:35` to `@ 02:45`, `04-driving.png` with the dial at 2). Then thirty seconds after the g-event the
co-driver goes quiet again, silently, and stays quiet for six minutes. That is the whole voice track of the guided drive:
one note, and "That's the drive." at the end (`guided-drive/transcript.txt`).

I read the code to be sure of what I was seeing. `isSpirited()` (`web/index.html:2164`) is true in Auto for thirty
seconds after any frame over 0.30 g lateral or 0.35 g longitudinal (`:2492`), and both the strip's corner rows and the
spoken corners are gated on it (`updateNotes`, `:2360` and `:2380`). So the co-driver in its default mode does not read
the road ahead and decide the road is interesting; it waits for the driver to prove it by cornering hard, then speaks
for thirty seconds. The first corner of this drive was shown only because the pull-out happened to exceed the
threshold; a driver who turned gently would have met the ramp unannounced. "Quiet until the road gets interesting" is
the right principle (REVIEW.md, and I would keep it). The trigger is wrong: interesting is a property of the road ahead,
which the app has in `track.events` with every corner's severity and apex speed, not of what the driver just did. A
real co-driver reads the first note before the car moves and never has to be shown the road is twisty. The lead of the
one call that was made is "just enough" by `note_timing.js` (speak + react + brake lands at 250 ft at 39 mph); a human
reads it a corner earlier and adds the distance ("tight right, two hundred") when it is far. And the two mode changes,
into Full and back to Quiet, were never spoken; the only sign was 13-pixel grey text. REVIEW.md planned the line
("Quiet from here. Bumps and cameras only."); the code speaks it only on a manual switch (`:5546`).

### The numbers under the arrow

Under the position arrow rides the sight-line speed: an eye glyph and a number in a paper plate. In the step photos,
taken ten seconds apart on a straight interstate at a steady 70, it reads 67, 55, 97, 88, 124, 89, 83, OPEN, 122, 81,
83, 91, OPEN, 79, 67 in red, OPEN, OPEN, 104, 90 (`guided-drive/phone/05` to `25`). At a standstill it read "21 MPH"
(`02-drive-started.png`, dial 3). On the car's screen it goes red at 67 and 64 while the car does 70 in a 65
(`guided-drive/car/19-driving.png`, `33-driving.png`), which is the plate's alarm state: "faster than you can see". I am
not judging the sight line's accuracy (the brief forbids it, and a replayed drive can't tell me). I am judging a
number that changes every time you look and lights red on a motorway. It teaches the driver, in one drive, to ignore
the one red thing on the map. The fix is display hygiene: hysteresis, a hold, five-mph steps, red only after it has
held, hidden under 5 mph, and OPEN whenever the sight line clears the limit by a margin. The same value sits in the
binnacle's Sight cell in red all the time, so the screen has two reds with two meanings a hand's width apart (I push
back on that at the end).

### The car

The CarPlay screen is, in its bones, right, and App Review would recognise it: Where to?, Loops and Places on the
idle bars, our own ink map in the base view, the trip preview card with "Drive" in green, the guidance card with a tulip,
a trip strip, End top right, four map buttons (`guided-drive/car/01` to `03`). The map is the phone's map at the car's
scale; the themed hairlines read on an 800×480 panel. That is more than most third-party navigation apps manage.

Then the drive goes onto the interstate and the card freezes: "13.1 mi · Tight right" (`car/04`), "12.4 mi" (`09`),
"10.7 mi" (`19`), "8 mi" (`33`), "6.4 mi" (`41`), the same tulip for seven minutes. The next thing in the route's events
is indeed a tight right thirteen miles on, and `guideMessage` (`web/carplay.js:67`) returns the next corner or turn
and nothing else. Apple Maps would show "Continue on I-275 West for 13 mi" with a straight arrow and switch to the
corner when it is near. A 13-mile corner on a maneuver card is also the thing most likely to make a reviewer read
corners-as-maneuvers as a stretch. Before it, at the very start, the card said "0 ft · Very tight right, opens up"
with a tulip I had to read twice (`car/02-drive-started.png`): a vertical stem, a tight arc and an arrowhead pointing
down, which at card size looks like a pennant. The corner it describes is the one under the car at the start. It was
never spoken (notes within 10 m are skipped) and the phone did not show it; the car did. The two screens disagreed in
the first second.

The trip strip reads "-- arrival · -- min · 35.4 mi" for the whole drive (`car/02` to `41`). The dashes are honest: a
GPX has no router time. But the app computes a speed envelope for every track (`brakingEnvelopeMps`), and a time
from it is as much a forecast as any router's. A navigation card with no time on it, on a 35-mile route, is a card
drivers will not trust. Behind the card, at the start, the corner plates pile: R1 sits on the car, an R2 is half under
it, L3 is clipped by the screen edge (`car/02`). The declutter rule (CALL_SHEET 2026-10-29) did not run at the moment
guidance began.

The free drive is worse, and it is one message. Start a drive on the phone with no route and the car never knows.
For three minutes its screen is the idle map: Where to?, Loops, Places, no End, no Rec, no card; only the sight plate
appears under the arrow (`free-drive/car/02` to `20`). The shell flips into a drive only when a `guide` message arrives
(`CarPlay/ApexCarPlay.swift:136`), and `carGuide` returns without sending one when there is no route
(`web/index.html:6141`). A driver who starts "the road ahead" from the phone cannot end it from the car, and the car
offers no way to start it either (no Drive key on the idle bars). And when the guided drive ends, the car does not go
idle: it shows the trip preview again, "Dry Ridge Rd · 35.4 mi · Drive", for the same route you just finished
(`car/42-drive-ended.png` through `47`), because `driveEnded()` calls `routeChanged()` with the route still set.

### Report, the island, the phone on its side

The hazard report is the one drive interaction that is better than Waze. Report, six plates in signal orange
(Pothole, Gravel, Debris, Animal, Police, Road closed), Cancel underneath; tap one and the sheet is gone and the Report
key has become "Undo Gravel" (`guided-drive/phone/15-report-sheet.png`, `16-reported.png`). Two taps, an undo, no
confirmation. Keep it exactly. One thing missing: the car's screen and the phone's map show no pin where the report
landed (`car/16`, `phone/16`).

The Live Activity did appear in the simulator's island, and it reads "--" on the left and "NO NOT" on the right
(`guided-drive/phone/23-home-live-activity.png`, `24`). The code explains it: with no note ahead the page sends the note
"No notes ahead" and no short code, the widget takes six characters of the note and upper-cases them
(`web/index.html:6161`, `LiveActivity/ApexLiveWidget.swift:69`). On the lock screen (not visible in the simulator; judged
from the code) the same state prints "No notes ahead" in title3 bold over "Dry Ridge Rd" with an empty distance.
Flighty's island is the standard here: two short, true values at every moment. Vetta's should read "● REC" and "QUIET
· 13 MI" when quiet, and "250 FT · R2" when a note is up.

On its side the cockpit works (`guided-drive/phone/26-landscape.png`, rotated to read): map left, the instruments in a
column right with Rec, Report and End above them. The step photos are saved in portrait pixels with the content
rotated, which is a recording fault, not the app's. The strip, though, spans both columns and leaves its right half
empty above the instruments; the status line could live there and give the map the full height.

### Ending, and the Log

"That's the drive." is a lovely line. The card is not yet a lovely moment (`guided-drive/phone/42-drive-ended.png`,
`free-drive/phone/21`). A quarter-screen of map so dark the trail is a thread, DRIVE SAVED in tracked caps, "Circle
Freeway", "6.9 mi · 7 min", a rule, the two pencil bars over "/1000", VETTA SCORE, "Not enough clean corners for a
score this time.", and then the solid key is "Share card": share what? The weight is upside down for this drive: the
primary action on a drive with no score should be the Log or Done, and Share goes solid only when there is a score to
share. And the drive is named after the road it spent the most miles on, not the route the driver chose; the one
who planned "Dry Ridge Rd" will look for it under that name.

The Log's drive page is strong and I would keep its order (`43-in-the-log.png`): the name, the date, the score
(honest bars), the four part-scores as "--", the one-line facts, Replay as the solid key, Compare and Share as links,
the Speed/Smoothness toggle, the map with the trail, then the lanes: Speed, Cornering g, Brake and throttle g,
Elevation, with the pencil cursor and the six-cell readout (`44` to `47`). One cheap note: the zoom row ends in "◀ ▶",
which iOS renders as the blue emoji triangles (`drive_view.js:466`). The brief bans emoji and the page did not mean to
use them; a text-presentation selector or an SVG chevron fixes it.

### The themes and the account, which the recording did not reach

Tapedeck and Billet were never shown: both flows drove in Roadbook (`tapedeck-night/phone/03` to `16`,
`billet/phone/02` to `12`). The test tapped the theme's name on its card, and the card does nothing when tapped; only
its small "Use" key does (`renderThemePicker`, `web/index.html:5334`). That is a finding about the card as much as the
test: a theme card is a 300-pixel preview of itself and should switch the theme when touched. Everything I would say
about the themes in use waits for the second recording. The theme cards themselves (`tabs/phone/15` to `17`) read
well: each preview in its own type and glow, "LEFT 4 TIGHTENS 42", the voice's one-line character and a Hear key.

The signed-in flow signed nothing in. Crew stayed on the signed-out page for all six steps, and "account" opened
Google's sign-in sheet (`signed-in/phone/01` to `14`). The session was set in the Keychain and the page was told by a
script evaluated at launch (`reviewSetup`, `ApexNavApp.swift:669`), evidently before the page could hear it. Two things
for real users came out of it anyway: the Google sheet says "to continue to senftns.workers.dev", which is the moment a
new member decides whether to trust the app with an account; and Sign in with Apple renders as the real white
button now, which it did not in review 3.

---

## 2. Verdict

Vetta's idle map, binnacle, hazard report and Log page are already drawn at the level of the apps the owner names,
and in a car they would be recognised as made with care; the CarPlay screen is structurally what Apple asks for and
better looking than most. But watched in motion, the co-driver, which is the whole promise, does not yet lead: in its
default mode it speaks only after the driver has already cornered hard, it called one note in seven minutes, it shows
a number under the arrow that changes every glance and lights red on a motorway, and the car's screen holds a
13-mile "Tight right" or, with no route, nothing at all. Three things stand between this and greatness: a co-driver
that reads the road ahead (wake on the route's next corner, call the first note before the car moves, say when it goes
quiet and when it comes back, and say what is on the road under you); numbers that hold still and mean one thing
(the sight plate, the two reds, a time on every route); and a car screen that is in the drive from the first second
to the last (a "continue" step, a free-drive session, idle after End). None of the three is a redesign. All three
are visible in the first two minutes of the next recording.

---

## 3. Findings

| ID | Severity | Flow / step (evidence) | What's wrong | The fix (files) | How the next recording shows it |
|---|---|---|---|---|---|
| U-58 | P0 | guided-drive: `phone/02-drive-started.png` (Clear · Quiet at the start), `phone.mp4 @ 02:24` to `@ 02:29` (the corner appears only after the 0.3 g pull-out), `transcript.txt` (one call in 6 min 16 s); free-drive `transcript.txt` (none) | In Auto the co-driver speaks and shows corners only for 30 s after the driver exceeds 0.30 g lateral or 0.35 g longitudinal (`isSpirited`, `web/index.html:2164`, `:2492`). It follows the driver instead of reading the road: the first corner of a drive is called only if the pull-out was hard, a tight corner after 30 s of calm road is never called, and both transitions are silent. | `web/index.html` `isSpirited`/`updateNotes`: spirited is true when the route ahead within max(2 × leadM, 800 m) holds a corner that needs braking (apex speed below current speed − 2 m/s, `ApexNoteTiming.needsBrake`) or severity ≤ 3, or when the g test passes; always call the first note of a drive, including one under 10 m when the car is stopped ("First, tight right, two hundred"); speak the transitions once each ("Quiet from here. Bumps and cameras only." / "Notes on.", the clips exist in the voice bank per `:5545`), never more than once per two minutes. Keep Quiet for straight road. | On the Dry Ridge section (§6, start the replay there) every corner of severity ≤ 3 is in the transcript with a lead of 5 s or more at the speed driven; the first line of the drive is a corner call; "Quiet from here" and "Notes on" appear once each on the interstate join and leave. |
| U-59 | P0 | free-drive: `car/02-drive-started.png` to `car/20-driving.png` (idle bars, no End, no card, no Rec for 3 min while the phone records, `phone/02` to `20`) | A drive with no route never reaches the car: the shell enters a drive only on a `guide` message (`CarPlay/ApexCarPlay.swift:136`) and `carGuide` sends none without a route (`web/index.html:6141`). The driver cannot end the drive from the car, and the car offers no way to start a free drive. | `web/index.html` `enterDrive`: `carPost({ kind: 'start', title })`; `ApexCarPlay.swift` `case "start"`: `driving = true`, `driveStarted()` with a trip of no choices, a maneuver "Recording · the road ahead" (the record-dot symbol) and estimates of distance driven; `idleBars()`: a trailing "Drive" bar button that sends `start` (two leading, two trailing is within CPMapTemplate's limit). | free-drive `car/02` shows End top right, the Rec card and the report/mute/zoom buttons; `car/01` shows Drive on the idle bars; `car/21` returns to idle. |
| U-60 | P1 | guided-drive: `phone/05` to `25` (sight plate 67, 55, 97, 88, 124, 89, 83, OPEN, 122, 81, 83, 91, OPEN, 79, 67 red, OPEN, OPEN, 104, 90 at a steady 70), `phone/02` (21 MPH at 3 mph), `car/19-driving.png`, `car/33-driving.png` (red at 67 and 64 while doing 70 in a 65); same in free-drive `phone/06` (125 MPH at 54) | The sight-line speed under the arrow changes every glance and goes red (the "faster than you can see" alarm) on a straight interstate. Not a question of accuracy (out of scope): a display with no hysteresis teaches the driver to ignore the one red thing on the map. | `web/index.html` around `:2500` (and the same message to `web/carmap.js`): quantise to 5 mph (10 km/h); adopt a new value only when it differs by ≥ 5 for ≥ 2 s; red only after the condition has held 3 s; hidden under 5 mph; OPEN when the sight speed exceeds the posted limit by 15 mph; the cluster's Sight cell follows the same filtered value. | Consecutive step photos on the interstate show the same plate or OPEN; no red plate at 70 in a 65 on a straight; no plate while stopped. |
| U-61 | P1 | guided-drive: `phone/23-home-live-activity.png`, `24-home-live-activity-later.png` (island reads "--" and "NO NOT"); lock screen judged from `LiveActivity/ApexLiveWidget.swift:17` with `web/index.html:6161` | With nothing ahead the page sends note "No notes ahead" and no short code; the compact view prints six characters of it. Leading shows "--". On the lock screen the drive reads "No notes ahead · Dry Ridge Rd" with no distance. | `web/index.html` `pushActivity`: when there is no note send `short: track ? 'QUIET' : 'REC'`, `distance` = distance driven when there is no note distance, `note` = "Quiet · next corner 13 mi" (from the car's guide distance) or "Recording · 3.4 mi"; `ApexLiveWidget.swift`: compact leading shows the record dot when distance is empty, trailing `minimumScaleFactor(0.8)` and never a truncated word. | The island in `23` reads "● REC" and "QUIET"; with a note up, "250 FT" and "R2". |
| U-62 | P1 | guided-drive: `car/42-drive-ended.png` to `47` (after End the car shows "Dry Ridge Rd · 35.4 mi · Drive" again) | `driveEnded()` calls `routeChanged()` with the route still set, so the finished route is offered again as a trip preview. | `web/index.html` `leaveDrive`: after `carPost({kind:'end'})` also `carPost({ kind: 'clear' })` when the drive was on a route (the phone forgets the active route already, `forgetActive`); `ApexCarPlay.swift` `driveEnded`: `trip = nil`, `hideTripPreviews()`, idle bars. | `car/42` shows the idle map with Where to? / Loops / Places and no card. |
| U-63 | P1 | guided-drive: `car/04-driving.png` to `41` ("13.1 mi · Tight right" counting down for 7 min on I-275), `car/02-drive-started.png` ("0 ft · Very tight right, opens up" under the car at the start, never spoken) | `guideMessage` (`web/carplay.js:67`) returns the next corner or turn however far it is; a corner 13 miles away sits on the maneuver card for the whole motorway, and the corner under the car at the start is the first maneuver. | `web/carplay.js` `guideMessage`: when the next event is more than 2 km away return a continue step (`type` straight, instruction "Follow I-275 West" from the road name at the cursor via `ApexRoadNames`/`track.roads`, `distM` to the event); skip events behind or within 15 m of the cursor when speed is under 2 m/s at drive start; `index.html` `carGuide` already resends on key change. | `car/04` reads "Follow I-275 · 13 mi" with a straight tulip; the card changes to "Tight right" within a mile of it; `car/02` shows the first real corner, not "0 ft". |
| U-64 | P1 | guided-drive: `car/02` to `41` (trip strip "-- arrival · -- min" all drive), `phone/01-route-from-gpx.png` ("35.4 mi · 32 corners", no time); planning `phone/09-loop.png` (the loop card: no time) | A GPX or loop route has no router time, so no screen shows a time or arrival, and `eta.js` has nothing to scale. A time from the route's own speed envelope is a forecast like any ETA, not a measurement. | `web/index.html` where a GPX/loop track is built: `timeS` = Σ ds / envelope speed (`Core.brakingEnvelopeMps` with the posted limits as the cap) when the router gave none; `eta.js` then works unchanged; the card and the car strip show it; label nothing "with traffic". | `car/02` shows minutes and an arrival; `phone/01` shows "35.4 mi · 1:05 · 32 corners"; the Live Activity's etaShort is filled. |
| U-65 | P1 | first-run: `phone/01-opening.png` (the idle map; no welcome), `phone.mp4 @ 01:00` to `@ 01:07` | Onboarding is gated on `!window.APEX_EMBED` (`web/index.html:6492`) and the shell sets `APEX_EMBED` (`ApexNavApp.swift:287`): the welcome, the three-call strip loop and the single Start never run in the app. `docs/APP_REVIEW.md` says first run is one screen. | `web/index.html:6492`: drop the `APEX_EMBED` clause (keep the link-parameter exceptions); in the shell, request location after the welcome's Start (`ApexNavApp.swift:529`) so the permission sheet follows a reason; update APP_REVIEW.md. | first-run `01` is the welcome with the strip cycling three calls and the red Start; `02` is the location sheet; `03` the idle map. |
| U-66 | P1 | signed-in: `phone/01-crew.png` to `06` (signed-out Crew), `08-account.png` to `14` (Google's sheet "to continue to senftns.workers.dev") | The review session did not sign the app in: `reviewSetup` evaluates the `session` message at launch (`ApexNavApp.swift:669`), before the page can take it. And the Google consent screen names a workers.dev host, which every real member sees at the moment of trust. | Shell: post the `session` message on the page's ready signal (the same place `hello` is answered) or have the page read the Keychain state on load; owner: Google Cloud OAuth consent screen app name "Vetta" and a custom domain for the Worker's auth path (OWNER_TODO). | signed-in `01` shows the member's Crew page; `07` Friends; `08` the account in the Garage; the Google sheet, when it appears, says "to continue to Vetta". |
| U-67 | P1 | guided-drive: `phone/05` to `41` (strip "Dry Ridge Rd · Quiet · bumps and cameras only" on I-275; binnacle "Road: --"), `phone/42-drive-ended.png` (the app names the drive "Circle Freeway") | The quiet strip names the route, not the road under the car; the binnacle says the road is unknown while the app knows it; nothing says when the notes come back, though the car's card has the distance to the next corner. | `web/index.html` `updateNotes` quietText: "Quiet · {road under you} · next corner {dist}" using `ApexRoadNames` (the same source `leaveDrive` uses to name the drive) and the next corner from `track.events`; the cluster's Road line from the same name; "Clear" stays the hazard word but at the weight of the line, not the lockup, when it is the only thing shown (`web/instruments.js:124`). | `phone/08` reads "Quiet · I-275 · next corner 13 mi" with "Road: I-275" on the binnacle. |
| U-68 | P2 | first-run: `phone.mp4 @ 01:03.2` to `@ 01:05.2` (OpenFreeMap Liberty in daylight white with POI icons), the same in tabs `phone.mp4` | The map loads the Liberty style and is restyled afterwards (`web/index.html:1552`, `restyleBasemap`): two seconds of a stranger's map on every cold start. | Start the map container on the theme's paper colour with the canvas at opacity 0 and fade it in on the first `idle` after `ApexBasemap.restyle`; or bundle a themed style JSON per theme (same sources) so the first paint is ours. | No light frame between the launch screen and the ink map. |
| U-69 | P2 | tapedeck-night: `phone/01-theme-tapedeck.png`, `02-night.png` (the card tapped, Roadbook still "In use", and the drive in Roadbook `03` to `16`); billet `phone/01`, `02` to `12` | A theme card is a 300-pixel preview and does nothing when touched; only its small Use key switches (`renderThemePicker`, `web/index.html:5334`). | `renderThemePicker`: the card's preview (`themePreview`) is a button that calls `useTheme` (or `tryTheme`), with the Use key kept as the word; `UITests/ReviewFlows.swift` `theme()` taps "Use" inside the named card. | tapedeck-night `03` to `16` are Tapedeck at night; billet `02` to `12` are Billet. |
| U-70 | P2 | planning: `phone/09-loop.png` (after Find a loop: a one-line bar "43 mi loop · 42.5 mi · 118 corners"), guided-drive `phone/01` (the same for the GPX) | The route card as instruments (`web/route_card.js`) sits behind an unlabelled grabber; after a 30-second search the result is a receipt. | `web/index.html` where the loop/route resolves: `openPlan(true)` so the card shows with Start on it; the collapsed bar's `routeBar` gets a visible "Details ˄" word; a drive start still closes the sheet. | planning `09` shows the stamped distance, time and corners, the profile with ticks and the dials; `10` to `11` scroll it. |
| U-71 | P2 | planning: `phone/10-loop-1.png`, `11-loop-2.png` ("5s" key under Layers while the camera fits the loop); guided-drive `phone/02`, free-drive `phone/02`, tapedeck-night `phone/03`, billet `phone/02` ("2s" at drive start) | The recenter key's whole face is a countdown (`recenterLeft`, `web/index.html:1975`), and it appears after camera moves the app made itself (fit to route, drive start). | Only call `scheduleResume` after a user gesture (pointer/touch on the map), never after `fitBounds`/`resetCamera`; draw the glyph always and the countdown as a thin ring or underline on the key, with the seconds in the aria-label only. | No "2s" or "5s" key in any drive-start or loop photo; the key shows the recenter glyph after a drag. |
| U-72 | P2 | free-drive: `phone/15-driving.png` (strip "Checking route…" at 2.15 mi with no route) | The off-route/reroute status line is used when there is no route (`web/index.html:3305`): a driver with no route is told the route is being checked. | `:3305`: when `!track` or `track.kind !== 'route'` keep the road-ahead line ("The road ahead · Quiet …") and never the rerouter's words. | free-drive strip never says "Checking route" or "Off route". |
| U-73 | P2 | planning: `phone/02-suggestions.png` ("Winton Woods Middle S…", "Winton Woods Golf Cou…", addresses cut too) | The suggestion row gives the name and the address one line each side (`renderPlaces`, `web/index.html:4160`: `b` + `span` in one row). | `.place`: name on its own line in full, the address below in 13 px pencil, the kind stamp right; trim "Cincinnati, OH, United States" to the street and town. | Every row in `02` shows the full place name. |
| U-74 | P2 | guided-drive: `phone/03-driving.png` (toast "Mount set. Bumps and banking are recording." over the map at 250 ft from the first corner), `phone.mp4 @ 02:30` | A system toast lands in the middle of the map at the moment of the first call. | Put the mount confirmation in the status line ("● Rec · mount set" for 6 s) instead of a toast; and hold any toast while a note is within its lead distance (the `_holdUntil` mechanism, `:3931`). | `03` shows the corner countdown with no toast over the road. |
| U-75 | P2 | guided-drive `phone/42-drive-ended.png`, free-drive `phone/21`, tapedeck-night `phone/16`, billet `phone/12` ("Share card" solid under "Not enough clean corners for a score"; the route "Dry Ridge Rd" saved as "Circle Freeway") | The end card's primary key is Share on a drive with nothing to share, and a planned route is named by the road most driven. | `web/index.html` `showEndCard` (`:6296`): Share solid only when a score exists, else "Open in the Log" solid and Done; name the drive after the route when one was driven (`leaveDrive`, the `road` fallback only for free drives). | `42` shows "Dry Ridge Rd" with Open in the Log as the solid key. |
| U-76 | P2 | guided-drive: `phone/44-in-the-log-1.png` to `47` (the zoom row's "◀ ▶" drawn as blue emoji glyphs) | `drive_view.js:466` uses U+25C0/U+25B6, which iOS renders in emoji presentation. | `'◀︎'`, `'▶︎'` (text presentation), or the inline SVG chevron the Log's "‹ Log" uses. | The pager arrows are ink, not blue. |
| U-77 | P2 | guided-drive: `car/02-drive-started.png` (R1 on the car's arrow, an R2 half under it, L3 clipped at the edge) | The car map's plates pile at the moment guidance begins; the declutter (hazards first, nearest corners, nothing under the arrow) did not run on the mode change. | `web/carmap.js` `mode()`: call `placePlates()` after `camera()` settles (on `moveend`), and exclude plates within 28 px of the car's arrow and the sight plate. | `car/02` shows separated plates and a clear arrow. |
| U-78 | P2 | guided-drive: `car/02-drive-started.png` (the "Very tight right, opens up" tulip reads as a pennant) | The hairpin tulip (`cornerTulipSVG`, `web/carplay.js:178`) is a stem, a 180° arc and a down-pointing arrowhead; at 120 px with a 9-unit stroke it reads as a flag. | Draw the hairpin as the road-book glyph: a longer stem, a wider return leg (radius 20, stroke 7) and the arrowhead on the return leg at 45° to the stem; test it at 60 px. | The hairpin card in the next recording reads as a corner at a glance (the owner's own photo in the car is the real test). |
| U-79 | P2 | free-drive: `car/01-idle.png` (Where to? / Loops / Places; no way to start a drive) | A driver in the car with no destination has to pick up the phone to start a free drive. | With U-59: a "Drive" trailing bar button on the idle template that sends `start`. | `car/01` shows Drive; tapping it in the recording starts the free drive from the car. |
| U-80 | P3 | first-run `phone.mp4 @ 01:00` to `@ 01:03`, tabs `phone/01-map.png` (a 40 px mark alone on black for three seconds) | The launch screen is a small mark with no name on an empty field; it leads into the light-map flash (U-68). | LaunchScreen: the wordmark at the brand size on the theme's dark paper, the mark above it, matching the idle map's background so the cut to the map is invisible. | The launch frame and the first map frame share a background. |
| U-81 | P3 | first-run: `phone/03-layers.png` (the panel cuts the place plate to "Colerain Towns") | The Layers panel overlaps the place plate. | `web/index.html` CSS: when `.edge.open`, the place plate slides up out of view (or the panel starts below the plate's bottom edge plus 8 px). | `03` shows the plate whole or gone, never cut. |
| U-82 | P3 | first-run: `phone/03-layers.png` ("Notes · Auto" row), `phone.mp4 @ 01:06` to `@ 01:12` (a tap flips it to Full), `transcript.txt` ("Full notes.") | The Notes row cycles its mode on a tap with no affordance; every other mode in the app is a detent. | Make the row a three-stop detent (Quiet · Auto · Full), the same control the Garage's Night row uses. | `03` shows the detent. |
| U-83 | P3 | guided-drive: `phone/26-landscape.png` to `29` (rotated to read: the strip spans both columns, its right half empty above the instruments) | In landscape the strip takes the full width for one line of text, and the map loses that height. | Landscape CSS (`web/index.html:857` block): the strip over the map column only; Rec/Report/End move up into the strip's right half above the instruments. | `26` shows the map the full height of the left column. |
| U-84 | P3 | guided-drive: `phone/08` to `22` (the car's arrow at mid-height of the map; the road ahead gets less than half) | At 70 mph the look-ahead is a few hundred metres of screen; navigation apps place the car in the bottom third. | Follow camera padding: the arrow at 70 % of the map's height in a drive (`resetCamera`/`setVehicle` padding), 55 % under 25 mph. | The arrow sits in the lower third of the map in every driving photo at speed. |
| U-85 | P3 | guided-drive: `phone/14` to `21` (up to three "FUEL" stamps on the map at 70 mph) | Fuel-stop stamps are drawn along the route in a drive whether or not fuel matters now. | Show at most the next stop's stamp in a drive, or none until the route's fuel line says it is needed; all of them in the preview. | At most one FUEL plate in any driving photo. |
| U-86 | P3 | guided-drive: `phone.mp4 @ 02:35` to `@ 02:45` ("0 FT · TIGHT RIGHT" held for ten seconds while stopped on the ramp), `@ 02:46` to `@ 02:47` (the strip flicks to Clear and back on a position jump) | A note at 0 ft stays as the lead while the car waits; one GPS jump flips the strip twice in two seconds. | `updateNotes`: a passed note (distM 0 for more than 3 s under 2 m/s) advances to the next; debounce the lead-note change by 600 ms. | The strip advances while stopped at a passed corner and never flickers. |
| U-87 | P3 | first-run: `phone/02-idle-map.png` ("On the twistiest roads nearby · map only until driven") | "map only until driven" is internal jargon. | `#loopSuggest` text: "On the twistiest roads nearby" alone; the measured/estimated distinction belongs on the route card's Surface dial, which already says "--" until measured. | The idle deck reads one clause. |
| U-88 | P3 | guided-drive `phone/42-drive-ended.png`, free-drive `phone/21` (the end card's map is near black with a thread of a trail) | The map on the card is not fitted to the trail and the trail is drawn thin. | `showEndCard`: fit the camera to the drive's bounds with padding, draw the trail at the route's width in the accent, and dim the basemap one step; it is the picture the share card will carry. | `42` shows the whole drive as a red line on the dark map. |
| U-89 | P3 | guided-drive: `car/01-route-from-gpx.png` ("Cincinnati" under the attribution line; the card's middle blank) | Small car-screen untidiness on the preview. | `web/carmap.js`: pad the map's bottom by the attribution height so no label sits under it; the preview card's middle shows the summary (corners, Fun) when there is no time. | `car/01` has no label under the attribution. |

Counts: P0 2 · P1 8 · P2 12 · P3 10 (32 findings, U-58 to U-89).

---

## 4. The voice

What was said, in every flow (`*/transcript.txt`):

| flow | lines | when |
|---|---|---|
| first-run | "Full notes." | 03:38:22, after a tap on the Notes row (not a drive) |
| guided-drive | "Tight right" · "That's the drive." | 03:47:09 · 03:53:25 (a 6 min 16 s drive) |
| free-drive | "That's the drive." | 03:40:51 (a 3 min drive, no other line) |
| tapedeck-night | "Tight right" · "That's the drive." | 03:48:23 · 03:50:24 |
| billet | "Tight right" · "That's the drive." | 03:37:38 · 03:38:57 |

- **Timing.** The one corner call of each guided flow is the ramp onto I-275, made at about 250 ft and 36 to 39 mph
  (`guided-drive/phone/03`, `car/03`, `phone.mp4 @ 02:30`), five seconds before the corner, which the lead formula
  (`note_timing.js`: speak 1.4 s + react 1.2 s + braking) produces exactly. The replayed driver was already braking when
  the call came (the dial 36 → 17 over the next five seconds). "Just in time" is the wrong target for a co-driver: the
  standard is the note before the driver needs to think, which means one corner's warning earlier at road speeds and the
  distance spoken when the lead is over 100 m ("Tight right, two hundred").
- **Density.** One call in 6 min 16 s of guided driving and none in 3 min of free driving. The road justified most of
  that silence (an interstate), and that silence is the design. But two things should have been said and were not: the
  corner under the car at the start (`car/02` shows it, the phone never did, the voice skipped it under the 10 m rule),
  and the two mode changes, into Full at `phone/05` and back to Quiet at `phone/08`, which happened in 13 px grey only.
  A co-driver who stops talking says so; one who starts again says so. Both lines exist in the voice bank (`:5545`).
- **Wording.** "Tight right" is a good call: two words, the severity first as rally notes do. The car's own card said
  "Very tight right, opens up" for the start corner, so the same engine words a corner two ways on two screens
  (`carplay.js cornerWords` versus the phone's `e.call`); the car should take the phone's words, which it does for
  spoken corners (`opts.call`), and nothing else. "That's the drive." is the best line in the app; keep it.
- **What the recording cannot say.** Whether two calls land on top of each other, whether a chained call ("tight right
  into left four") reads cleanly, whether a hazard interrupts a corner, and how the three voices differ in character:
  no flow reached a run of corners. §6 fixes that.

---

## 5. Roadmap 4

Each item is one PR; the order is the order to build.

1. **The co-driver reads the road** (U-58, U-67, U-86; `web/index.html` `isSpirited`, `updateNotes`, `instruments.js`
   `renderNotes`). Wake on the next corner ahead, call the first note of a drive, speak the transitions, name the road
   under the car and the distance to the next corner in the quiet line, advance a passed note. One PR because they share
   `updateNotes`.
2. **The car is in every drive** (U-59, U-79, U-62, U-63, U-77, U-78; `web/carplay.js`, `web/index.html` `enterDrive`,
   `leaveDrive`, `carGuide`; `CarPlay/ApexCarPlay.swift`; `web/carmap.js`). A `start` message and a free-drive session,
   a Drive bar button, idle after End, the continue step, no corner under the car, plates that keep clear, the hairpin
   glyph.
3. **Numbers that hold still** (U-60, U-64; `web/index.html` around `:2500`, the GPX/loop track builder, `eta.js`).
   Hysteresis on the sight plate and cell; a time from the envelope on every route.
4. **Out of the app** (U-61; `pushActivity`, `ApexLiveWidget.swift`). Short true words in the island and on the lock
   screen.
5. **The first open** (U-65, U-68, U-80; `web/index.html:6492`, map init, LaunchScreen, `ApexNavApp.swift:529`). The
   welcome in the app, no light map, a launch screen that leads into the idle map, location asked after Start.
6. **Planning surfaces** (U-70, U-71, U-73, U-69; the plan sheet, `recenterLeft`, `renderPlaces`, `renderThemePicker`).
   The card rises when a route resolves, the recenter key stops counting at the user, names win over addresses, theme
   cards switch on touch.
7. **Small words on the drive screens** (U-72, U-74, U-75, U-81, U-82, U-83, U-84, U-85, U-87, U-88, U-89). One PR of
   strings, CSS and camera padding.
8. **The Log's glyphs** (U-76; `drive_view.js`).
9. **The recording and the account** (U-66 and §6; `UITests/ReviewFlows.swift`, `ApexNavApp.swift` `reviewSetup`,
   `tools/review_pack.py`). Build this one first if the second recording is to judge items 1 to 8.

---

## 6. The recording itself

What it should add or change so the next pack catches what this one missed:

1. **Start the replay where the corners are.** Every drive spent its minutes on Colerain Avenue and I-275 and ended at
   6.9 mi; the road's own corners were never reached. Give `ApexReplay` a start offset (`APEX_REPLAY_FROM=<km>` or a
   named section) so the guided, Tapedeck and Billet drives begin a mile before the Dry Ridge Rd twisties, and keep one
   flow (free-drive) from the real start so the interstate join is still seen. Then shoot every 3 s through corners.
2. **Themes: tap "Use".** `theme()` taps the card's name, which does nothing (U-69); tap the Use key inside the card and
   assert the `data-theme` attribute before starting the drive. Add a Roadbook-at-night step too, and a step of each
   theme's Replay.
3. **Planning: tap the row, not the field.** `find(["Winton Woods"])` matched the search field's own value. Match the
   `.place` button (its label carries the address) and wait for `#routeBarName` to change; then scroll the open card.
   Add a step with the card dragged open, and one with the plan sheet's More.
4. **Tabs after a drive.** Run `test02Tabs` after a drive exists (or tap "watch a replay") so the drive detail and Replay
   steps show something; today steps 02 to 07 are the empty Log and the Replay never appears.
5. **Signed in.** Deliver the session after the page is ready (U-66) and assert the Crew page shows the member before
   shooting; the `app.tap()` after Friends landed on "Sign in with Google" and opened Google's sheet.
6. **Landscape photos in landscape.** Save the rotated steps with the pixels rotated (or rotate in `review_pack.py`)
   so the contact sheet reads.
7. **The island, expanded.** Long-press the island on the home-screen step to photograph the expanded Live Activity,
   and once with a hazard as the next note.
8. **The car, on events.** Photograph the car 1 s after each `guide` key change and after a hazard report (the pin and
   the alert), not only every 10 s; add a step where the drive is started and ended from the car.
9. **First run before the stray tap.** `start()` taps the screen before the first photo; move the "opening" shot
   before `app.tap()` (it is what dismissed nothing today, but it will dismiss the welcome once U-65 is fixed), and add a
   step for the location permission sheet.
10. **Clock in the frame.** The app hides the status bar in a drive, so transcript times cannot be matched to the video
    without the car's clock. Have the pack note the video's start wall-clock in `INDEX.md` (simctl's recording start
    time), so a transcript line maps to a video second.

---

## 7. Pushback

- **Two reds, one hand apart.** The binnacle's Sight value is red at all times by the theme contract (REVIEW3 kept it),
  while the sight plate under the arrow goes red only when you are faster than it. In `guided-drive/phone/17` the cell
  says "Open" in red and the plate says OPEN in ink. I would make the cell ink and let red mean one thing on the drive
  screen: faster than you can see.
- **"Quiet until the road gets interesting" should not mean quiet at the start.** Keep the principle; call the first
  note of every drive and say when the notes go quiet and return (U-58). A co-driver's silence is a decision the driver
  should hear being made.
- **Every corner as a maneuver (`CAR_CORNERS = 'all'`).** I agree a corner you must slow for is guidance, but only with a
  continue step between corners (U-63). A 13-mile "Tight right" is the frame a reviewer will photograph.
- **Naming a drive by the road most driven.** When a route was driven, the drive should carry the route's name; the
  road name is right only for a free drive (U-75).
- **"Unknown stays unknown" and the ETA.** A time on a GPX or loop route from the route's own envelope is a forecast,
  not a measured value dressed as one. Showing "--" for the whole of a 35-mile drive (U-64) costs more trust than it
  protects.
