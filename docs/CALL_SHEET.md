# Call sheet

Decisions Claude made for you, newest first. Each one says what was decided, why, and how to undo it. Read the top until
you reach one you've seen. If you disagree with a call, say so and it gets reversed; nothing here is hard to undo unless
it says so. Things only you can do are in docs/OWNER_TODO.md.

## 2026-11-10 (fable-road-page): About a road says its climb, and speaks in words (claude/fable-road-page)

A bug first: on any road with 40 m or more of climb, the sheet's first line read "Switchbacks · 0.8 mi · descending
[object Object]". The climb was given to the formatter for short distances, which returns a number and a unit as a
pair. It now uses the height formatter the route card uses: "descending 308 ft", or metres.

Then the words. The sheet listed TECH, FLOW, SURF, CLEAR and "Confidence: L0 · From the map only", which are the
code's names. They are now Technical, Flow, Surface and Clear road, each with a few words on what it measures, its
score, and a bar as long as the score. An unknown score is "--" with an empty bar and says why ("not measured by
members yet"); nothing is guessed. "How sure" is said in words with no L0/L1/L2. The closing note read "scored by a
simulated sane driver"; it reads "as a careful driver would take it. Never a speed to aim for."

Undo: revert the PR. The scores themselves and how they are worked out are unchanged.

## 2026-11-10 (fable-pin-names): a place you pin or tap goes by its name, never by coordinates (claude/fable-pin-names)

Hold the map on Foothills Parkway and the pin's sheet said "Foothills Parkway", but Go here then filled Where to? with
"35.667000, -83.812000" and named the route "To Pin 35.667, -83.812". Tap the map did the same. Now the field and the
route carry the name the sheet showed ("To Foothills Parkway"); a place tapped with no lookup is "Dropped pin" and its
route "To a dropped pin". The exact point still goes to the router (it rides beside the field and holds while the text
is unchanged; the swap key takes it across). A named pin becomes a recent place; an unnamed one never does. I did not
make Tap the map wait for the road's name: that would put a network lookup in front of planning.

Three smaller things on the same screens: the pin's third key said "Save as highlight" and opened "Add a spot", so it
now says "Save as a spot". A spot's rating lit only the star you chose (five stars looked like one); it now fills up
to it, pale after, the way the spots list already draws stars, and Save and Cancel sit in one row at one height. The
notes under a search that finds nothing said "Press Go" while the key under them says "Search"; they say Search, and
"offline" is only said when the phone is offline.

Undo: revert the PR. Typed coordinates still work as before and are still named "Pin lat, lon".
## 2026-11-10 (fable-one-corner): "1 corners" is "1 corner"; a Best roads nearby key keeps its word while it searches (claude/fable-one-corner)

A road with one corner read "1 corners" on its card's line, under its big number, aloud to a screen reader, in "1 more
good corners", in a stage's line in the Log and in a coach's sentence. All say "1 corner" now. And in Best roads nearby
the key you tapped ("Within 15 min") turned into "Finding roads" over a line that already said "Finding roads…"; it
keeps its own word and only its progress bar moves.

Undo: revert the PR.

## 2026-11-10 (fable-there-and-back): a trip to a place can come home another way in one tap (claude/fable-there-and-back)

The route card of a trip to a place has a new key, "There and back, home another way". It plans the drive home too,
staying off the road you drove out on wherever another way exists, and the destination becomes a stop on the trip.
Calls made: the way home is chosen by the same Fun / Long way rules as any route (so it may be longer, on better road);
where our own map tiles don't reach, the public router is asked to avoid the way out; a dead end that has only one way
in says so instead of failing. Undo: hide `#routeRoundBtn` (one line in renderRouteCard), nothing else depends on it.

## 2026-11-10 (fable-your-data): Your data is three short lists, like Settings (claude/fable-your-data)

For your "cohesiveness, less clunky": Your data was eight keys of eight widths in two wrapped rows, one of them a link
and two of them red text. It is now the same rows as the Settings list it opens from, in three groups: Take a copy
(Download drives, Download account data, Import a drive), Offline (Save the map here, Delete offline data), Remove
(Delete drives on this phone, Erase everything on this phone, both in red). Each row does what it did; the confirm
sheets are unchanged. A row acts when touched, so it has no chevron; the file type sits at the row's end in pencil.

Undo: revert the PR.

## 2026-11-10 (merger): e2e may run 35 minutes, not 25 (claude/project-thread-er8kzz)

The e2e suite is 152 flows now and takes about 24 minutes, so GitHub cut it off at its 25-minute limit on the last flow
(twice on #349, once on #344) with every flow before it passing. The limit is 35 minutes. No test is skipped or
shortened. Undo: set `timeout-minutes` back to 25 in `.github/workflows/core-tests.yml`, or better, split the suite.

## 2026-11-10 (fable-loop-time): a loop can be set by time on the dial (claude/fable-loop-time)

Following your "the whole point is aimless driving": "I have an hour" is how a loop is usually asked for, and time
loops were two keys (1 hour, 2 hours) at the bottom of Options. The loop dial now has two words over it, Distance and
Time. On Time its five detents are 30 min, 1 h, 1½ h, 2 h and 3 h; Find a loop builds a loop of that driving time
(the search that already existed for the Options keys), the loop is named by its own time, and its card's row reads
Time with the same five keys. The dial remembers which you used. A time loop asked for from Options or Siri turns the
dial to Time as well, so the card always changes the loop in the unit it was asked in.

Also: a time loop's note said "the closest good loop to 1.5 h"; times now read "1½ h" everywhere.

Not changed: Options keeps its 1 hour / 2 hours keys and My free time. Undo: revert the PR.

## 2026-11-10 (fable-layers): design pass 8: the Layers panel is the map's legend (claude/fable-layers)

Layers was a column of names and switches: "Cameras" (which cameras?), "Measured roads" (three colours on the map and
nothing saying what they mean), and "Who sees me" hanging under 3D terrain. Now each layer is drawn beside its name the
way the map draws it, in the look's own colours (so it matches by day, by night and in every look), over one line of what
it is: Twisty roads "From the map's shape" (it is not measured, and now says so), Measured roads with its three colours
named (Smooth, Fair, Rough), Cameras "Plate and speed cameras", 3D terrain, Friends "Sharing where they are". A layer that
is off has its key dimmed. Friends moved to the end so "Who sees me" sits directly under it. The panel is 52 px wider
(288 px, less on a narrow phone) so each line fits on one row.

Not changed: what any switch does, the Co-driver half (Notes, Voice, music).

Undo: revert the PR.

## 2026-11-10 (fable-polish-7): design pass 7: Settings is three short lists, and each row says what it is set to (claude/fable-polish-7)

Behind the Garage's gear was one list of eleven rows that said nothing: to learn whether Crash check was on or which
units you were in, you opened each sheet. Now the list is three short ones under their names (Sharing and safety, How
the app reads, You and Vetta), and a row says its setting on the right: Privacy zones "None" or "2 places", Crash
check and Reminder "On" / "Off", Units "Miles and feet", Map motion "Lean". Change one in its sheet and the row has it
when you come back. A row with nothing to say (Feedback, About) says nothing; a row never guesses.

The order of the rows is unchanged. Undo: revert the PR.

## 2026-11-10 (fable-drive): Location turned off is said, and Settings is one key away (claude/fable-drive)

Found while looking over the drive screen. In the iPhone app, a driver who tapped "Don't Allow" on the location sheet (or
turned Location off later) was told nothing: the map had no arrow and a drive sat on "Finding GPS…" for ever. In a browser
the sheet said "Location is off. Settings → Safari → Location → Allow" twice, in red, under the heading "Before your first
drive", over a greyed-out "Allow and start", and Just drive went grey with no word.

Now: the app tells its page when Location is off (and forgets the stale position). Just drive, a route's Start and
Recenter stay keys; with Location off they open one sheet: "Location is off", why it matters, and Open Settings (the
app's own page in Settings). Back from Settings with it on, the sheet goes away by itself. In a browser the key is "Try
again" (a page can't open Settings). A drive whose Location is turned off mid-way says "Location is off", not "Finding GPS".

Swift changed (ApexNavApp.swift: a `location_off` field on the live frame, an `openSettings` command); I can't compile
Swift here, so CI's build is the check. Not changed: when Location is first asked (after the welcome's Start).

Undo: revert the PR.

## 2026-11-10 (fable-loops): a loop has no Quick / Fun / Long way; its card offers its length and which way to head (claude/fable-loops)

You asked: "why do loops need a long way a fun and a quick? the whole point is aimless driving". They don't. On a
loop's card the three level cards are gone (on the test loop they were three copies of the same loop). A loop is now
found one way whatever the destination level is set to: good roads, about the length you asked for, off the highways
(the engine's Fun; someone whose level was Quick used to get loops that could be a quarter highway).

What a loop's card offers instead is the loop's own: its length (as before), and which way to head. When the search
finds really different loops, up to three are cards, each drawn as its own outline (north up, a dot where you start),
named by where it goes (North, Southeast…; "Around here" when it circles the start), with its time and corners. A tap
puts that loop on the map; nothing is planned again, so planning takes no longer. The second and third cards are loops
that head somewhere else when one is within reach of the best (60 degrees apart, within 100 points), before any
lookalike. With one loop found there are no cards: nothing to choose. Two loops can share a name (both Southeast);
their outlines tell them apart.

Not changed: the 1 hour / 2 hours loops and "My free time" in Options, and the ranking functions' Quick and Long way
weights in fun_route.js (unused by the app now, still tested).

Undo: revert the PR. To bring a level back for loops only, set `LOOP_STYLE` in web/cockpit.js.

## 2026-11-10 (fable-paths-are-keys): "Garage → Settings → Spots" is a key, not a path to walk (claude/fable-paths-are-keys)

For "reducing any clunky feelings": Where to?'s Spots near you, when empty, read "No shared spots near here yet. Add
one in Garage → Settings → Spots." It now reads "No shared spots near here yet. **Add one**", and the key opens
Settings on Spots. The crash sheet's note had the same arrows ("Add an emergency contact in Garage → Settings → Crash
check to text someone from here."); nothing in that sheet should lead away from Call and I'm OK, so it gets no key,
only a plain sentence: "To text someone from here, add an emergency contact in Settings, under Crash check."

Left for after #358 (it rewrites the same lines): Your data's "deleted from the server in Settings → Account → Delete
account".

## 2026-11-10 (fable-one-loop-home): Options loses its "1 hour / 2 hours" loop keys; a loop by time is the dial's (claude/fable-one-loop-home)

Since the loop dial can be set by time (30 min to 3 h), Options' "Loop to fit: 1 hour, 2 hours" was a second, smaller
copy of it in another place. It is gone: one setting, one home. "Loop to fit" keeps My free time and This album, which
only the app can answer, so in a browser the group is put away rather than left as an empty heading.

Undo: revert the PR.

## 2026-11-10 (fable-design-offline): design pass 5: People with no connection is a page, and comes back by itself (claude/fable-design-offline)

With no answer from the server, People was a heading ("Can't reach Vetta"), a grey line and a small key at the top of
an empty sheet, the same on both sides, and the Garage's top corner was an empty band. Now it is a page built from the
signed-out page's parts: a road that stops at the red dot with the way on dotted, the headline set large, what still
works without a connection as three rows (driving and notes, your Log, saved routes), and Try again at the foot,
under the thumb.

Three calls. It says which it is: "You're offline." only when the phone itself says it has no connection, otherwise
"Can't reach Vetta." (the app never blames your signal for our server). It asks again by itself when the phone says
the connection is back, so nobody has to press Try again to find out. And the Garage says in its own corner that your
cars and profile will be back, and that looks, voices and settings work without it.

Undo: revert the PR.

## 2026-11-10 (fable-settings-values): the last three Settings rows say what they are set to (claude/fable-settings-values)

Design pass 7 gave each Settings row its value, but Road feel, Route tuning and Spots still said nothing (noted then as
next). Now: **Spots** counts yours ("2 spots", "None"); **Route tuning** says "Standard", or "1 changed" once a slider
has moved (the words of its own status line), and goes back to Standard after Reset; **Road feel** says On or Off from
its Share road feel switch when you are signed in. Signed out there is no switch to read, so the row says nothing:
a row never guesses. Route tuning also says nothing if the tuning is not this phone's to use (after Pro goes on sale,
for a phone without it), since its sliders are kept but the routes are the defaults.

Undo: revert the PR (three `data-summary` attributes in web/index.html, `data-summary-text` in web/garage_settings.js).

## 2026-11-10 (fable-end-card): design pass 9: the drive's score is set against your usual; the card's keys sit evenly (claude/fable-end-card)

The drive-ended card's big number had nothing to stand against: is 673 good? Now, on the label's line, it says "33 over
your usual" (or "12 under your usual", or "About your usual" within five points). Your usual is the middle score of your
last ten scored drives before this one, read from the Log on the phone. With fewer than three there is no usual, and the
card says nothing rather than guess. It compares across roads: the score is the driver's, not the road's. If you would
rather it compared only the same road, say so (that already has its own line, "Your best on this road").

The keys: Share card is a row of its own; Mark a stage and Drive it again share the row under it (it was two keys and an
orphan on a second row). Nothing changes place when the score lands.

Undo: revert the PR. The numbers are `USUAL_N`, `USUAL_MIN`, `USUAL_NEAR` in web/end_line.js.

## 2026-11-10 (fable-suggest-follows-dial): the idle map's "Loop from here" says the length the dial is on (claude/fable-suggest-follows-dial)

The row under Where to? read "Loop from here · 45 mi" from launch on, whatever you had turned the dial to, while its
Plan key built the dial's loop: turn the dial to 15 mi, cancel, and the row still promised 45. It now says the dial's
length (or time, once #342 is in) the moment you pick it. Undo: revert the PR.

## 2026-11-10 (fable-stages): on a stage's page a run is named by when it was driven (claude/fable-stages)

Under "Runs · Dry Ridge Rd" every run was titled "Dry Ridge Rd" again (a drive is named after its road), with the one
thing that tells runs apart, the date, in small grey under it. The date is now the run's name; the drive's own name is
under it only when it isn't the stage's. And a stage's length is to a tenth like everywhere else (it said 21.34 mi).

Undo: revert the PR.

## 2026-11-10 (fable-fix-join-scope): my mistake in #332, fixed: the signed-out People page also showed at the top of the Garage (claude/fable-fix-join-scope)

The rule that lets the new signed-out People page fill the sheet named the People panel by its id, and an id outranks
the rule that hides the other tabs' panels. So, signed out, the whole "Drive with friends." page stood at the top of
the Garage as well. Both rules now apply on the People tab only. I had read the page on People and never opened the
Garage signed out after the change; the screen-by-screen flow now checks that the Garage shows no People page.
- Undo: not something to undo; reverting #332 would also remove it.

## 2026-11-10 (fable-your-units): sizes that were always metric are in your units (claude/fable-your-units)

Three places spoke metric to a driver in miles: a privacy zone's size ("200 m / 500 m / 1 km", and the list and the
toast after), a crew page's "about 11 km across", and "Drives under 0.2 mi are dropped" the other way round for a driver
in kilometres. A zone's size now reads 650 ft / 0.3 mi / 0.6 mi in miles (the zones themselves are unchanged: 200, 500
and 1000 m), the crew line says "about 7 miles", and the short-drive toast follows the unit. The privacy page
(privacy.html) still says 11 km: it is one text for everyone.

Undo: revert the PR.

## 2026-11-10 (fable-loop-names): a loop's cards are never two of the same way at the same length (claude/fable-loop-names)

A loop's "which way" cards could come up as two Southeasts, 39 and 37 minutes: the same choice twice, told apart only by
squinting at the outlines. A second loop that heads the same way as one already offered is now a card only when it is
a really different drive: a fifth longer or shorter, in distance or in time (`LOOP_OFFER.differs` in web/fun_route.js).
Loops that head somewhere else are offered as before. So there can be fewer cards than three (or none, when every other
loop found is a lookalike); the best loop is always the first one.

Undo: revert the PR, or set `differs: 0` in `LOOP_OFFER`.

## 2026-11-10 (fable-quiet-news): What's new never comes up over something you have started (claude/fable-quiet-news)

After an update the "What's new" sheet came up 1.2 seconds into the launch whatever you were doing: I caught it
covering the Options sheet while choosing roads, and it could also land on the splash. Now it shows only on a still,
empty map. While the splash is up it waits for the map. Once you have touched the screen, opened Where to?, a sheet or
a tab, or are driving, it leaves this launch alone and is there the next time the app opens untouched (it is not
marked as seen until you close it).

Cost: someone who always taps within the first second sees the news a launch or two later. Undo: revert the PR.

## 2026-11-10 (fable-log-dates): the Log's records and charts say "30 Oct", not "2026-10-30" (claude/fable-log-dates)

The Log's list stamps each drive "30 OCT", but Your records under it printed 2026-10-30 and the two score charts
labelled their dots 10-30, like database fields. Records now read as the rest of the Log does (Today, Yesterday,
"30 Oct", with the year when it isn't this one) and the charts' days read "30 Oct" (in the phone's own order, so
"Oct 30" on a US phone). Undo: revert the PR.

## 2026-11-10 (fable-design-signed-out): People, signed out, is a page instead of a form (claude/fable-design-signed-out)

Design pass 3, after your "designed by an artist not a programmer". Signed out, People was a logo, a small heading,
three boxed icons and a button, with two thirds of the phone left blank under them. The calls:
- **A drawing leads each side.** A road drawn the way a printed map draws one, with pucks on it: two roads meeting
  for Friends, one road with three in file behind a red lead for Crews. It is decoration, drawn by hand in the page,
  never a map of real people.
- **The name is set large** ("Drive with friends.", "Drive as a crew.") in the app's number face, and each of the
  three things it gets you is a row with one plain line saying what it is, shaped like the friends list that will
  stand there after sign-in.
- **The sign-in keys stand at the foot of the page**, under the thumb, 52 pt tall. Apple's key is square-cornered
  now so it matches every other key in the app (Apple's rules let the corner match); it is still first and the same
  size as Google's.
- **The Vetta logo is gone from this page.** It sat above Friends only, and the first-run screen already shows it.
- **A waiting friend or crew link is a boxed line** above the keys, so it reads as the reason to sign in.
- Undo: revert the PR; nothing is stored and no behaviour changed.

## 2026-11-10 (fable-design-garage): the Garage's looks stand on a shelf you turn sideways; Your cars signed out is an empty bay (claude/fable-design-garage)

Design pass 4. The three look cards were stacked: 750 px of the Garage before you reached the voice picker. The calls:
- **On a phone the looks stand side by side**, one in view with the edge of the next showing; a turn of the thumb
  brings the next and it settles in place. The Garage is about a quarter shorter and the voice picker is on the
  first screen. It opens on the look in use.
- **A mouse, or large text, keeps the stack.** A mouse wheel can't turn a shelf, and a card of big words reads
  better whole.
- **A sideways drag on the shelf no longer closes the Garage** (a drag to the right anywhere else still does).
- **Your cars, signed out, is an empty bay**: a pencil outline where a car will stand, "No car parked here yet",
  and a Sign in key that opens People. It was a grey paragraph telling you to go to "(People)".
- Undo: revert the PR.

Added after CI went red: a quick flick could fly the shelf past the next look to the last one (a turn of 260 px
ended on Billet, not Tapedeck). Each look now stops the shelf (`scroll-snap-stop: always`): one look a turn, however
fast the thumb. A drag of more than a whole card still goes as far as you drag it.

## 2026-11-10 (fable-tile-limits): posted limits from the government road inventory: junk out, good ones into travel times (claude/fable-tile-limits)

Where the map has no speed-limit sign, the app knows a second source: the government road inventory (HPMS). I
measured it against the signs the map does have, on every road of the Cincinnati tiles. The calls:
- **A limit under 25 mph from the inventory is unknown.** Its 30 mph and up agree with the map's signs on 76 to 99 %
  of the km; its 20 mph on 63 %, its 15 mph on none. One Indiana county (Switzerland) reports 15 mph for every county
  road, so Bryants Creek Drive and Wade Hill Road (12 and 9 km of the back roads this app is for) were "posted at 15"
  and took the engine's worst speed mark: about 64 km of such roads here score 0.03 to 0.05 better without it. A real
  20 mph street loses nothing: the estimate that stands in is as slow to the engine. Takes effect on phones at once
  (the reader refuses the value) and in the baked tile scores at the next "Graph region" build. Undo:
  context_grid.js and tools/ctx_etl/build.py `LIMIT_MPH` back to 5.
- **Tile travel times use the inventory's limit where the map has no sign**, instead of a guess from the road's class.
  It posts one on 41 % of the unsigned primary and 36 % of the unsigned secondary km, where the guess is off by more
  than 5 mph on a third to four fifths of them. Expect primary roads about 3 % slower and secondary about 1 % slower
  in the tiles' times after the next build (the guess was 55 where 45 is posted). OSM's own sign still wins.
- **Guards against a wrong match**: the inventory must cover half the edge and six tenths of that must be one value;
  a ramp keeps its estimate; a freeway's limit never goes to the road beside or under it. Numbers: score_edges.js
  `INVENTORY`. Undo the whole time change: `inventoryLimit` returns null.
- **It needs the tile rebuild, which I didn't run** (Actions → "Graph region (own routing, OH+KY+IN)" → Run
  workflow; the same run the expressway change is waiting for). The build id changes with it.
- **Left alone, for a driven check**: a few Indiana roads the inventory posts at 25 to 30 mph look low too (State Line
  Road, 11 km at 25). They can't be told from real town limits by the number, so they stay.

## 2026-11-09 (fable-road-carry): road data from roads with no signal is kept on the phone and sent later (claude/fable-road-carry)

Found while looking for what matters most: matching a drive to the map needs the network, and a trip that ended with no
signal (or an app closed while it was retrying) lost every road section it had not sent. The roads worth measuring are
the ones with no coverage, so the best roads' data was the data being lost. The calls I made:
- **What is kept**: only what the trip would still have sent (the 5 m rows between the trip's private ends, never the
  first or last 0.5 to 1.5 km, and built chunks not yet posted). On the phone, in IndexedDB (web/road_carry.js).
- **How long**: 13 days (the server takes a drive for 14), at most 40,000 rows (200 km) in all; over that the oldest
  trip goes first.
- **When it is sent**: when the phone is back online, when the app is shown again, 8 s after launch and every 5 min while
  something waits. Only with Road data still switched on (checked before anything is matched) and never in a review
  recording. A refusal from the server drops it.
- **Backlogs go in 10 km pieces** (`maxRun` 2000 rows in contributor.js createLive), during a drive too, so a second
  drop-out costs one piece. This is the only change to a trip that has signal all the way: none, unless 10 km is waiting.
- **Erase everything removes it**, without a new line in cockpit.js: the index is the localStorage key `apex.roadCarry`,
  which Erase already clears, and a missing index empties the store on the next load. Your data says "road data from
  N mi waiting for signal" while something waits. privacy.html says all of this in the Road data paragraph.
- **Signing out, deleting the account and switching Road data off empty it at once** (cockpit.js `clearCarry`), so
  nothing measured under one account is sent under another. Undo: drop the `clearCarry()` calls.
- **A drive begun with no signal shares on the last answer the server gave** (sync.js `roadShare`, kept in
  `apex.roadShare` only while signed in). Before, such a drive never shared (the "may I?" check needs the server), so it
  had nothing to carry: the trip from a trailhead car park was the one always lost. Nothing is sent on a remembered yes:
  it waits, and goes only after the server says Road data is still on. Undo: `member()` and `contributionEnabled()`
  again in `startLiveSharing` and `checkAmbientAllowed`.
- **The end of a drive says what waits**: "Shared 3.1 mi of road feel. 4.0 mi more waits for signal.", and later "Sent
  4.0 mi of road feel that waited for signal." Uploads sent later count in app health like the live ones.
- **A bug found on the way: recorded drives never said they were recorded.** contributor.js built `rec` (and `hr` under
  the quiet-hours flag), the server read them, the privacy page described them, and web/sync.js sent neither, so no road
  has ever been counted as loved (the routing's "members come back to this road" signal). It sends them now. Nothing to
  migrate: loved counts start from here.
- Not done: no line on the drive bar says what waits while driving.
Undo: remove `<script src="road_carry.js">` from web/index.html (createLive then has no carry and behaves as before,
apart from the 10 km pieces; set `maxRun` to Infinity for that).

## 2026-11-10 (fable-surface-map): the Measured roads map shows how the pavement is (claude/fable-surface-map)

While you drive → Measured roads drew every measured road in one green, so the one thing only Vetta knows about a road,
what members' phones felt there, wasn't on the map. The server already sent it. The calls:
- **Colour is the pavement**: green smooth, amber fair, red rough; thickness still says how sure (one pass faint, five
  or more bold). A road sent without roughness is drawn in ink, never as smooth. Undo: cockpit.js, the `apex-coverage`
  `line-color` line back to `C.gain`.
- **One scale for the words**: smooth is under 0.10 g and rough over 0.22 g of mean roughness, the same two numbers
  the route overview already words a road with (a test holds the two together). Change them in coverage.js
  `SMOOTH_G` / `ROUGH_G` and route_story.js at once.
- **A two-way road shows its better-measured direction** (both averaged when equally sure), since one line can only be
  one colour.
- **Tap a measured road and it says it in words**: "Smooth pavement (0.07 g) · many passes · 30% of it banked". How
  sure stays a level ("one pass so far", "a few passes", "many passes"), never a count of passes or people. A route or
  option drawn over the road still wins the tap. Undo: the `apex-coverage` click handler in cockpit.js.
- **Red is the app's one "act on this" colour**, used here for rough pavement on purpose. If it fights the route line
  for you on a phone, say so and rough moves to another colour.
- No server, privacy or data change: same request, same two-driver / open-road rule, nothing new stored or sent.

## 2026-11-09 (fable-overview): "What this drive is like", read against real roads (claude/fable-overview)

I planned ten public trips round Cincinnati in the app and read each overview against the road it described. The calls:
- **The overview now updates once, a second or two after the card**, on routes from our own router. The first words come
  from the road tiles alone; the fuller data (woods, farmland, lanes, housing) arrives with the second ranking, and the
  lines are rebuilt from it in place. So "Mostly country roads." can become "Mostly two-lane country roads through
  farmland." while you look. Undo: the `paintStory(shown, true)` line in cockpit.js `ownRefine` (then own routes never
  mention land or lanes, as before).
- **Open ground needs more than one sign of building to be called suburbs.** Night lights alone were turning ten miles of
  the Harrison drive into "suburbs". Now the second-strongest sign decides. Undo: `settings` in web/route_story.js.
- **The "through town / suburbs" line leaves out stretches the engine scores as good road**, so houses along a river
  road aren't reported as a slow part. Harrison at Fun now says "About 1 mile through town at the start" instead of
  "About 7 miles through suburbs in places". Undo: `built` in `slowLine`.
- **A best part spread over many roads says "including"**: "7 miles of good road, including Morgan Ross and Millville
  Shandon Road", not "7 miles of Millville Shandon Road" (which is 3 miles long). Two roads that carry three quarters of
  it are still named outright. Tune: `T.NAMES_WHOLE`.
- **"Two-lane" means one lane each way.** It was also being said of four-lane roads.
- Not done: your own trips (their addresses aren't in the repo, by rule). `node tools/story_live.js colerain:fun` prints
  the lines for the public ones.

## 2026-11-10 (fable-glide-flake): the car map test that failed now and then was measuring wrongly, not the map (claude/fable-glide-flake)

The "car map glides" e2e flow failed twice in CI with "a frame leaps ahead", on PRs that don't touch the car map.
The map was fine. The test read the map's position from its own frame callback, which can run before the car map's
in the same frame, so it saw each move one frame late. After one long frame (a busy CI machine), a long frame's
travel was divided by the short frame after it and read as a leap. The calls:
- **The test now reads the shift when the camera actually moves and times it by the frame it moved in.** The limits
  are the same numbers as before. A real lurch (the map jumping further than the time allows) still fails.
- Shown both ways: with 140 ms stalls injected every 0.9 s the old measure fails (rateMax 0.139 against a median of
  0.011) and the new one passes with the same map.
- No app code changed. Undo: revert the PR.

## 2026-11-10 (fable-design-route-card): the route card says "swipe" with page marks, not a sentence (claude/fable-design-route-card)

Design pass 3b. Under the Quick / Fun / Long way cards the route card had two grey sentences stacked: "Swipe the card
for the next route, 2 of 3" and the route's why line. The calls:
- **The routes found are page marks**: one short stroke per route, the one on screen long and inked, then "2 / 3".
  It is the sign a phone already uses for "swipe sideways", and it moves when you swipe.
- **The words "Swipe the card for the next route" sit beside the marks until your first swipe, then go for good**
  (remembered on the phone as `apex.cardSwiped`; Erase my data clears it, and the words come back). A screen reader
  always hears "Route 2 of 3. Swipe the card for the next."
- **The line under the marks only speaks when the marks can't**: "Quick and Fun pick the same route", or "Another
  route found" for a route no level picked. Most of the time it is gone, and the card is one line shorter.
- You asked on 2026-11-04 that the card say what a swipe does. It still does, on the same row as the marks; it just
  stops repeating itself once you have done it. Say so if you want the sentence to stay forever.
- Undo: revert the PR.

## 2026-11-10 (fable-hazard-alive): a hazard you keep confirming stays on the map (claude/fable-hazard-alive)

The app asks "still there?" every time you pass a reported hazard, but the server only listened the first time each
person answered. So with few members, a pothole one driver passed and confirmed every day still went off the map a
week after the first answer. The calls:
- **Every "still there" keeps it alive from that moment**, whoever says it, as often as they say it. Reporting your own
  hazard again from the same spot does the same.
- **It still counts once per person.** "Confirmed by 3" means three different people; one driver can't raise it.
- **"Gone" is unchanged**: one per person, and two that outvote the confirmations end it at once, so one person can't
  keep a wrong report up against two who say it's gone.
- Server only, no app change, no database change. Undo: backend/src/hazards.ts `vote`, the `seenAgain` lines.

## 2026-11-09 (fable-expressway): an expressway counts as a highway at Fun and Long way (claude/fable-expressway)

"Fun should never go on the highway" covered motorways and trunk roads. Some divided, limited-access expressways are
mapped one class lower (`primary`), marked only by a tag. The calls:
- **Both tags count**: `motorroad=yes` (the one our notes named) and `expressway=yes` (how US mappers mark these
  roads). Either on a primary or smaller road makes it a highway to the levels' rule: never driven at Fun or Long way
  unless there is no other way, counted in "Uses 0.4 mi of ..." and never offered as a Best road nearby. Quick is
  unchanged. Undo one tag: osm_graph.py `drivable`, the `expressway` line.
- **It needs a tile rebuild to take effect, and I didn't run one** (it is a CI workflow that commits to the data
  branch; yours or the reviewer's to start: Actions → "Graph region (own routing, OH+KY+IN)" → Run workflow). Until
  then nothing changes on any phone: today's tiles don't carry the mark and the router treats them as before.
- **A new flag bit, not a new tile version**: old apps ignore the bit, new apps read old tiles as "not an expressway".
- Undo all of it: revert the branch's commits (tiles built with the flag still read fine in the old code).
## 2026-11-10 (fable-convoy-keep): a convoy can run past two hours, and says when it is about to end (claude/fable-convoy-keep)

A convoy ended two hours after it started, whatever was happening: a Sunday drive with a coffee stop lost its map
mid-road, with no warning, and the leader had to start a new one and invite everyone again. The calls:
- **The leader can keep it going, an hour at a time.** In its last half hour the convoy card has "Keep going 1 h".
  Only then, so it is someone there and driving who asks; a convoy can't be opened for six hours up front.
- **Six hours is the most one runs.** Longer than a full day's drive with stops needs a new convoy. Change:
  backend/src/convoy.ts `LIMITS.roomMaxMs` (and `keepMs`, `keepWindowMs`).
- **Everyone is told ten minutes before it ends**, on screen and aloud in a drive; the leader's notice has the Keep
  going key on it. Nobody finds out by losing the map.
- **Everyone is told at once when it is kept going** ("Convoy kept going: 1 h 9 min left"), because they joined a
  two-hour convoy and their position is shared for longer now. Leaving works as before. The privacy page and the
  convoy's own words say two hours unless the leader keeps it going, six at most.
- Nothing more is kept: positions stay in memory only, and the convoy still ends when the leader leaves.
- Undo: remove the `/api/convoy/:id/keep` route in backend/src/index.ts (the key never shows without the server's two
  numbers), and put "up to two hours" back in convoy_ui.js, cockpit.js and privacy.html.

## 2026-11-09 (fable-hpms-limits): a speed limit of "254 mph" is no limit (claude/fable-hpms-limits)

The government road inventory we read speed limits from (HPMS) marks "not reported" with a code. Our data build stored
that code as 254 mph, and the app took it as a real posted limit on 281 stretches round Cincinnati (mostly Boone County
back roads), which nudged how those roads scored. The calls:
- **Only 5 to 85 mph counts as a posted limit** (85 is the highest posted anywhere in the US). Anything else is
  unknown. The app now refuses such values in the data it already has, and the data build no longer writes them.
  Undo or widen: `LIMIT_MPH` in web/route_ctx/context_grid.js and tools/ctx_etl/build.py.
- **I did not rebuild the road tiles.** Their scores on those 281 stretches still carry the bad limit until the next
  "Graph region" run in Actions (the same run the expressway change needs).
- **I left the tiles' travel times alone.** The inventory knows the posted limit on about half the main-road miles where
  our tiles only guess from the road's class, and using it would make times truer, but a mismatched stretch would make
  them wrong in a new way. The numbers are in STATE for whoever takes it on.
## 2026-11-10 (fable-zone-samples): a new home zone hides you from friends at once (claude/fable-zone-samples)

Friends on the map keeps your home zones on the server too, so it can refuse a position inside one. Two gaps:
the zones only went up when you changed who sees you, so a zone added later in Settings never reached the server; and
the last position stored before the zone existed (a drive that ended at home) stayed visible until it aged out.
- **A zone added or removed goes up at once**, and the app sends its zones again at each launch while you share
  (one small request; nothing is sent while Nobody sees you). A failed background save says nothing and heals at the
  next launch. Undo: friends_map.js `syncZones` and cockpit.js `zonesChanged`.
- **The server forgets the position it held whenever the zones change** (added, moved, grown or removed), the same way
  it already does when you switch between Exact and Within a mile. Friends see you again from your next position
  outside a zone. Removing a zone also forgets it: simpler than working out whether the old sample was inside, and it
  costs at most one sample. Undo: presence.ts `presenceSettingsPut`, the `prev.zones !== zonesJson` half.

## 2026-11-09 (route-sliders): Tune your routes, a Pro screen open to everyone until Pro goes on sale (claude/route-sliders)

You asked for "every parameter with a slider for premium users", then: "remember everyone has pro if they are an early
user. Once we launch app store we will restrict to paid users and anyone who had the beta." The calls I made:
- **Pro now has a third kind, `tuning`** (web/pro.js `route_tuning`, `TUNING_OPEN`, `tuningOpen()`), with the themes'
  rule: open to everyone while Pro isn't on sale; once `proOnSale` is on, it needs Pro, which beta and early users have
  as the founding lifetime grant (MONETIZATION.md 3). tests/test_pro.py now allows exactly theme, livery and tuning;
  every other guard stays (nothing safety-related, nothing you made, no privacy control, no export). The routes everyone
  gets are unchanged: the sliders only move away from today's tuned values. Undo: `TUNING_OPEN = false` closes it now;
  dropping the item and kind takes it out of Pro.
- **Where it lives: Garage → Settings → Route tuning** (a row after Map motion). The route card gets a "Your tuning" chip
  beside Options when the route was planned with any slider moved (its label names them); a tap opens the screen.
- **14 sliders in four groups**, named for drivers: Time (Fun's extra time, how readily Fun spends it, the same two for
  Long way, how far Quick strays for a nicer road, when Fun and Long way say "take the highway"), Roads (corners, road
  quality and smoothness, scenery), Avoid (towns and businesses, traffic lights and stops, side streets and
  subdivisions), Data (members' road data, fits how you drive). Each default is today's number exactly (a test holds
  every one to the code), so an untouched screen is no tune at all. Bounds: time 10–100 % (Fun), 30–200 % (Long way),
  0–5 min (Quick), 1.25–4× (highway limit); weights 0–2× or 0–3×; lights 0.5–4×.
- **Fun's extra time moves more than the budget**: a bigger budget alone rarely changed the route (the router's price of
  extra time and its search reach decided), so the time slider also makes each minute cheaper (time / default) and lets
  the search look as far (the spread's detour weight and the goodness ceiling, never below today's). "How readily it
  spends it" scales that price again on its own. Undo: drop `price` / `reach` from those sliders in web/route_tuning.js.
- **The highway rule stays fixed** (Fun and Long way never drive highways); only its "too long, use Quick" limit slides.
- **Traffic lights and stops is a new router weight, `STOP_AVOID_X` (1)**: it weighs a signal's, stop's and give way's
  seconds in the search only, so a route can go round them while its ETA still counts only the real wait. Corners in
  the engine needed two new knobs, `W.FUN` (1) and `W.GAIN` (0.5); at those values the ranking is identical.
- **A bug fixed on the way**: the router kept each view's per-edge objective cached without the weights it was made
  with, so on a warm view a tune of `W_FUN` or `W_QUALITY` (the Dev panel's too) did nothing, and a tuned objective could
  have been served to a later untuned plan. The cache key now includes those weights.
- **What it reaches**: plans to a place in full (our router and the engine; on Valhalla's path the engine's and the levels'
  sliders), loops through our router's search (the road and avoid sliders; a loop's length is yours, so not the time
  ones), not Best roads nearby. The screen says so.
- **Kept on this phone only** (`apex.routeTuning`): there is no settings sync with the account to join (sync.js syncs
  drives and road data, not preferences), and a new one would be server work for one screen. Undo: add it to a
  preferences endpoint if one is ever made.
- **Saved as each slider moves; the next plan uses it.** "Use on the route on screen" re-plans the trip on the card, rather
  than re-planning while you slide. Reset to defaults puts every slider back.
- **When Pro is on sale and you don't have it**, the sliders are greyed with the Pro line, your settings are kept, and
  plans use the defaults. A developer's Dev panel numbers lay on top of the sliders, path by path.
- **For you**: a beta tester who never made an account has no founding grant to find at launch (MONETIZATION.md 3).

## 2026-11-09 (dev-mode): a Dev panel for you and @fish5spd (claude/dev-mode)

You asked for "a dev mode in the app that shows all routing parameters and other debug info for only me and my codev to
mess with". The calls I made building it:
- **Where it opens: Garage → Settings (the gear) → Developer → Open the Dev panel**, not a long-press. A row behind the
  gear can't be found by accident or by a reviewer poking at the map, and the Settings list already hides a row whose
  sheet is empty, so for anyone else there is simply no row. The panel slides over the top of the map (up to 62 % of the
  screen) so the route card and the map stay in view while you change things. Undo: a long-press instead means moving
  the button in cockpit.js `paintDevRow`.
- **The gate is the Satellite layer's**: only a fresh `/api/me` with `developer: true` (you by OWNER_EMAIL, @fish5spd
  by fingerprint, plus DEV_FINGERPRINTS). The panel's code (web/dev_panel.js) is fetched only for a developer; overrides
  and switches saved on a phone are ignored until `/api/me` says developer, and dropped (the panel closed, the offline
  simulation and lines removed) when it says otherwise. No URL parameter or stored setting turns it on.
- **Overrides are dotted paths** into the code's own tables: `router` = graph_router.js `K` (`A_MAX.fun`, `BUY.max`,
  `SPREAD.fun.0`, `ROAD.poor`…), `engine` = route_engine.js `W`, `levels` = fun_route.js `LEVELS` (budget, slackS,
  perMin), `hwy` = fun_route.js `HWY`. The panel lists the ones you named first and every other number under "All". Only
  numbers that already exist can be set, so a typo does nothing. They apply to plans to a destination (the first route
  and the plan); loops, reroutes and Best roads nearby still use the code's values. Re-plan saves and re-plans the trip
  on screen; Reset puts the code's values back and re-plans.
- **Force own router also stops asking Valhalla for routes** (its turn instructions are still asked for); a trip off our
  tiles then fails to plan, which is the point of the switch. Force Valhalla turns our router off.
- **Offline simulation** makes the page's requests to any other host fail and the page read as offline. The map's own
  tile reads and the routing worker's tile reads are separate and aren't blocked (the routing worker's tiles are on the
  phone anyway). For a real test, airplane mode is still the truth.
- **"Picked" shows the route the card ends on**: our plans are ranked again with the fresh context after the card is up
  (ownRefine), so the panel takes that second ranking and says whether it swapped the route.
- **Copy debug JSON** puts the summary on the clipboard: each candidate's minutes, km, router G and role, the engine's
  parts, why it lost, highway km and source, plus the timeline, the overrides and the versions. If the clipboard is
  refused, the text appears in a box to copy by hand.
- Undo: revert this commit; nothing on the server changed.

## 2026-11-10 (fable-design-pass): the empty Log and Stages pages are drawn; two Garage rows fall into line (claude/fable-design-pass)

The owner asked for the app to feel designed by an artist, not a programmer. I captured every main screen on a phone
shape and read them as a designer would. The populated screens hold together; the tells were at the edges. The calls:
- **An empty Log is the first page of the book**, not a sentence on a blank sheet: the page's own furniture in pencil
  (three dashed places for the score's figures, a dashed date stamp, an empty corner strip), a head ("Your first drive
  goes here."), one line, one full-width key (Start a drive) and a link (Watch a replay first). Nothing in the sketch
  is a figure: unknown stays "--". Undo: analysis.html `#historyEmpty` and the `.first-page` rules.
- **An empty Stages tab says what a stage is**, with a stretch of road drawn between its start and finish boards, and
  the one way to make one. Undo: analysis.html `renderSegments`, the `first-page` block.
- **The Log's Drives / Stages switch was set in Arial** beside Inter Tight everywhere else (a button doesn't inherit
  the page's face by itself). Found by scanning every page's controls for a system font; it was the only one.
- **Garage, Co-driver**: "Night" and "Co-driver's voice" were 18 px extra-bold labels under a 17 px section head, so a
  row outranked its own heading; they are row labels now, like the switches beside them. The sentence that told you
  Notes and Voice live in Layers broke over two lines with its link dropped under a full stop; it is a row: what they
  are set to on the left, "Change in Layers" on the right. Undo: index.html `.co-row` and the `.ctl-label` rule.

## 2026-11-09: NASA night lights taken off your to-do list

You said the Earthdata steps were confusing. Night lights already work from NASA's 2016 Black Marble image, which is
fine for telling lit towns from dark country roads; the newer yearly image would only refresh it. So the two Earthdata
rows are gone from OWNER_TODO and you don't need to do anything. The code stays: if an `EARTHDATA_TOKEN` secret is ever
added, the next "Context grid region" run uses the newer image by itself, and without one it keeps the 2016 image.
Undo: put the two rows back from git history (docs/OWNER_TODO.md before this commit).

## 2026-11-09 (drive-overview): "What this drive is like" on the route card (claude/drive-overview)

You asked for a plain-English overview of the type of drive a route will be. The card now has up to five lines, built
from what the ranking already knows about that route (web/route_story.js, no network, after the card is up):
"Mostly two-lane country roads through woods and farmland, 45–55 mph." / "The best part is 3 miles of Struble and Day
Road: 41 good corners, five of them tight." / "About 3 miles through town at the start, with 4 sets of lights." /
"Members' drives say Day Road is smooth and flows well." / "Wet roads and deer likely after dark."
- **Placement:** under the elevation profile, above the facts (Along, Climbs, Ahead, Weather). Only the first line shows;
  a tap on it opens the rest (a closed `<details>`), so the card is one line longer, not five. The why line and the
  level cards are untouched. Undo the placement: move `#routeCardStory` in web/index.html, or add `open` to show it all.
- **When a line is said:** each needs its data over enough of the route (docs/ROUTE_ENGINE.md "What this drive is
  like"; the numbers are `ApexRouteStory.T`). Thin data drops lines; with nothing known well enough the overview is
  hidden. "Country" needs two place signals (houses, density, buildings, addresses, land use, lights...) saying open
  ground, never the road class alone; speeds are posted or measured limits only, never the class estimate.
- **The best part** looks first for the engine's full mark for good road (quality 0.65) and only then 0.55, so a
  merely decent road either side doesn't swallow the highlight; each corner in a run counts as 25 m when runs are
  compared, so a twisty good stretch beats an equally good straight one. Undo: `T.GOOD_Q_HI` = 0.55, `T.CORNER_M` = 0.
- **Conditions** are the engine's own costs at the hour you'd be there (0.5 points or more), plus rain in the last 6 h,
  the forecast code, low sun and closures; never more than three. The Weather fact line can say rain too; both stay
  (one is the forecast at six points, the other the engine's per-sample data). Undo: drop `conditionsLine` from build.
- **Not on:** loops, GPX imports and a route restored after a reload (no ranking behind them: nothing said rather than
  a guess). Undo all of it: revert the commit.

## 2026-11-10 (fable-loved-roads): in the iPhone app a recorded drive counts toward loved roads (claude/fable-loved-roads)

#323 made the upload carry `rec` (a pass from a recorded drive), which loved roads are counted from. But only the
browser's drive set it. In the app one mounted stream carries the road feel through Start and End, and it never said
so, so the phones that matter still sent every pass as ambient. The calls:
- **The app's stream says "recorded" from the drive's first row on**, and keeps saying so for the rest of that trip
  (also once End was pressed: the rows already driven were the recorded drive's, and a trip can't be split after the
  fact). What it sent before Start stays an ambient pass. What waits for signal remembers it. Undo: cockpit.js
  feedAmbient `deliberate`, contributor.js `recorded`.
- **A drive whose road feel went (or waits for signal) is marked shared in the Log**, in the app and in the browser.
  The Log offered "Share <drive>" by hand for every recent app drive, under another drive id: tapping it merged the
  same pass into the road a second time. Undo: cockpit.js `nativeShared`, and the `|| waits` beside it.
- **Share by hand says when it couldn't.** A busy server or no signal answered 'retry', which was counted as sent:
  the button said "Shared 3 roads" and the drive was marked shared with nothing on the server. Now it says "Couldn't
  share. Tap to try again." Undo: contributor.js `contributeDrive`.

## 2026-11-08 (drop-fcc): FCC phone coverage removed, as you asked (claude/drop-fcc)

You said: "we can just drop fcc it's confusing". Everything #311 added for the FCC National Broadband Map is gone; the
Earthdata night lights from the same PR are untouched.
- **Removed:** the FCC download in tools/ctx_etl (`MobileCoverage`, `fcc_json`, `fcc_creds` and the `fcc` source in
  sources.py; `fcc_pick_files`, `fcc_tech`, `fcc_env`, `provider_count`, `latest_as_of` in transforms.py; the
  mobile_coverage step in build.py), the `FCC_USERNAME` / `FCC_API_TOKEN` passthrough in context-grid.yml and
  ctx-region.yml, the FCC tests in tests/test_ctx_etl_accounts.py, the fixture
  tests/fixtures/ctx_etl/fcc_listing_synthetic.json, the provider-count mapping `signalFromProviders` in
  web/route_ctx/car.js and its test, the FCC line in licenses.html and in About's sources (index.html), and the FCC row
  in OWNER_TODO.
- **The phone's signal is as it was before #311:** car.js copies the grid's `mobile_coverage` as it comes (no grid
  builds it, so it stays unknown and the card says "No coverage data"), and route_engine.js's own `signal_coverage` from
  that channel is unchanged. The channel's name stays in grid.py and context_grid.js, marked as having no source, so old
  and new bundles read the same.
- **If you added the FCC secrets in GitHub**, nothing reads them now; delete them whenever you like (Settings → Secrets
  and variables → Actions).
- Undo: revert this commit.

## 2026-11-08 (engine-rank): the good road a longer way buys now counts by its length (claude/engine-rank)

After the levels change, the router offered better roads but the app's final ranking still chose the shorter route on two
trips. I broke each route's score into its parts to see why.
- **Colerain, Long way: the ranking was wrong.** The 32 min route has 11 km more of the best road here, and it was
  beaten by the 17 min route only because it also drives about 3 km more suburb on the way out (-16 points). The ranking
  charged side streets per km but counted good road only as an average, so 11 km of the best road was worth about +3 in
  quality. Its 19 more good corners (+15) and Long way's low time price (-5) couldn't make up the difference. Now each km
  of good road gained over the quickest is worth 1.5 points (side streets still cost 10 a km), capped at 30.
  Colerain's Long way is now the 32 min route ("17 more good corners", +16 min). Undo: `GOOD_PER_KM: 0` in
  web/route_engine.js. Tune: the same number (1.0 already flips colerain).
- **Subdivision4, Long way: the ranking was right and the router was wrong.** The 17 min route reaches 2.6 km of good
  road by driving 3 km more subdivision than the 12 min route. The router's goodness is an average, so the extra
  subdivision barely showed in it. The router now weighs its picks with the ranking's own per-km terms (side street
  avoided, good road gained), so its Long way pick there is the 12 min route, the same as the app's. The same rule fixed
  colerain's Fun pick, which had been a 20 min route through 2 km of strip mall: it is now the app's 17 min route. Undo:
  `K.ROAD.w = 0` in web/graph_router.js.
- **Side effects, all measured in the app:** northgate Fun is now 14.4 min ("nicer country", 1.1 km more good road) instead
  of 12.1; the two had been within 0.3 points. The router's own picks now match the app's on harrison (Fun 31.1 min, Long
  way 41.9 min); the app's picks there didn't change. Quick, the highway rule and trips with no good road are unchanged.
  Planning speed is unchanged.

## 2026-11-10 (fable-design-people): design pass 2, the route card's last row and the map's credit (claude/fable-design-people)

Second cut of the owner's "designed by an artist" pass, on the two screens people look at most. The calls:
- **The route card's last row is one ruled strip of keys** (Save, Share, Share ETA, GPX, Pin place). It was five
  underlined words centred on the page, "Pin place" alone on a second line. REVIEW2's two weights stay (Save and
  Share in ink, the rest in pencil); a key that is on (Saved, an ETA being shared) is inked in. With large text it
  goes two a row. Undo: index.html `.rc-links`.
- **The map's credit is a plate in the look's own style** (IDEAS U-53): a square paper plate ruled in ink with the "i"
  in the number face, where MapLibre's white pill and round black "i" sat on every map. It follows the look's tokens,
  so it is dark in the dark looks. The credit's text and links are unchanged. Undo: index.html, the
  `.maplibregl-ctrl-attrib` rules.

## 2026-11-08 (levels): Fun and Long way each spend their time on better road (claude/level-spread)

An audit of our phone router found Long way came back with exactly Fun's route on every test trip: the search for how
much to weigh good road stopped at its cap with time left, so Long way's bigger budget was never spent. And Fun on the
colerain trip took a road no better than one it could have had in the same 19.6 minutes.
- **The router now picks by how much better road the extra time buys**, not by "the most weight that still fits the
  budget". Each route it finds inside the level's time is scored by its average road goodness, minus a price for each
  extra minute over the level's quickest (as a share of that trip's time). Fun's price is 4x Long way's, so Fun takes good
  road that's near, Long way also the good road further off. Why: the old rule's routes avoid the worst stretches rather
  than seek the best ones. Measured on the 5 public trips: Long way now differs from Fun on 3 of them (subdivision4
  17 min, average goodness 0.32 against 0.26; northgate 29 min on 0.40 road against 14 min on 0.25; colerain 32 min, 0.40
  against 0.34), and Fun on colerain reaches 0.34 (from 0.30) and on harrison 0.47 (from 0.45) in about the same time.
  Undo: `K.BUY` = {} in web/graph_router.js (the old pick), `K.A_MAX` back to 40, `K.A_FIRST` back to 1 / 2 / 4.
- **One extra search finds those roads** (the "spread": a second route avoiding the first moderate route's roads).
  Planning on the phone costs about +10 % at Fun and +13 % at Long way (3-4 ms a plan in node). Undo: `K.SPREAD` = {}.
- **A longer route that isn't better is not offered as the pick.** If the extra time buys less than 0.1 of goodness
  per doubling of the trip's time, the quickest stays. So on the subdivision trip Fun and Long way now take the
  quickest (5.3 min) instead of 8.7 min on road almost as poor, and northgate's Fun the highway-free quickest (12 min)
  instead of 14. The longer routes stay in the list the route engine ranks. Tune: `K.BUY_MIN`.
- **Harrison: Long way = Fun (31.6 min, 0.47).** The best Long way road the audit found (42 min, 0.48) buys 0.01 for
  10 more minutes; at Long way's price that isn't worth it. If you'd rather Long way take every last bit of better
  road, lower `K.BUY.max` (0.01 takes it).
- Quick, the highway rules and loops are unchanged.

## 2026-11-08: Your four key answers: NREL is now NLR, Flickr dropped, Earthdata night lights, FCC coverage (claude/keys-1108)

Your answers: "flickr api unavailable for free users", "nrel link doesn't work", "earth data is made", "fcc account made".
- **EV chargers: NREL is now NLR.** The lab was renamed (National Laboratory of the Rockies); developer.nrel.gov no
  longer resolves, the same API answers at developer.nlr.gov. Our Worker now asks developer.nlr.gov
  (backend/src/chargers.ts). The secret keeps its old name `NREL_API_KEY`, so nothing to rename; the OWNER_TODO row points
  at developer.nlr.gov/signup (any api.data.gov key works too). Undo: the `NREL` const.
- **Flickr is gone, not parked.** With no free keys there is nothing to wait for: photos.js no longer has a Flickr path,
  `flickrApiKey` is out of the CTX_KEYS list, www.flickr.com out of the Content-Security-Policy, the Flickr line out of
  Sources and licences and the privacy page. Photo spots come from Wikimedia Commons (Mapillary still reads signs). A
  `flickrApiKey` already in CTX_KEYS is simply ignored. Undo: git revert of the Flickr commit.
- **Night lights from NASA's newest yearly Black Marble (VNP46A4) when the ETL has `EARTHDATA_TOKEN`.** Radiance r is
  turned into the 0..1 the grid already uses as min(1, (r / 20 nW) ** 0.7), picked so the old 2016 image's reading is
  kept (lit suburbs 1, a village about 0.27, farmland about 0.12, forest about 0.05; the engine calls under 0.15 dark).
  Those two numbers are my estimate, not fitted: the first real run logs how the new values compare with the 2016 image
  over the same cells ("night lights vs 2016 ..."), and they get tuned from that. Gap-filled pixels (from another year)
  count as unknown. If the token is missing, expired or refused, the whole run uses the 2016 image exactly as before
  (checked: the rebuilt Cincinnati bundles are identical to the committed ones). Tune: `NIGHT_SAT`, `NIGHT_GAMMA` in
  tools/ctx_etl/transforms.py. Undo: delete the secret.
- **Phone signal: the FCC's in-vehicle coverage, not outdoor.** You asked for 4G/5G outdoor; the FCC also publishes
  "in-vehicle mobile" coverage for 4G and 5G, which is what a phone in a moving car gets, and the grid's contract already
  said in-vehicle. So a state is read in-vehicle where the FCC lists those files, outdoor stationary only where it lists
  none (the bundle's sources say which, per state). Counted per ~240 m cell: how many providers report 4G LTE or 5G there
  (3G not counted). 0 means the FCC has no provider there; outside the states read it is unknown, and where one provider's
  file couldn't be read the count is unknown rather than one short. Undo: `fcc_pick_files` in transforms.py (prefer
  "outdoor").
- **What the phone does with it:** it already read the channel (the route engine's signal term, the car provider's
  no-signal stretch → "Share your ETA before the signal goes" → save the map for offline). The car provider now turns the
  provider count into its 0..1 signal as none 0, one provider 0.5 (it may not be yours), two or more 1, so a one-carrier
  valley isn't called "no signal". Undo: `signalFromProviders` in web/route_ctx/car.js.
- **Both secrets are passed to both grid workflows** ("Context grid (route data ETL)" and the OH+KY+IN region build), so
  the region's graph-data copy gets the same fields. h5py is added to the ETL's requirements only, not the app.

## 2026-11-08: Planning speed on production and a weak signal (claude/prod-speed)

Your goal: "planning in well under a second" for you, on the phone, with production. The slow numbers measured on
production (1.7-4.2 s) came almost entirely from how the test reaches it (a fresh browser each time, every request
through a slow proxy, the website loading the app's files and road tiles that the app has inside it); the same plans in
the same browser a second time took 0.2-0.8 s. What a phone could also pay was the network on a weak signal, so these:
- **The road tiles' index is never waited for when the phone has a copy.** Once a day the region's index (which tiles
  exist outside Cincinnati) was asked again, and every tile load, so every plan, waited for the answer; on one bar that
  could be seconds, and a request that hung held planning for as long as it hung. Now the kept copy is used at once and
  the new one is asked behind it; on a first launch with no copy, it gets 3 s, then the app's own tiles plan alone.
  Undo: the `ttl > 0` line and `INDEX_WAIT_MS` in graph_tiles.js baseIndex.
- **The routing worker starts when the app opens**, not with the first plan (it reads its tiles' index then). Costs a
  little memory while idle. Undo: the `ownRouter().ready()` line in cockpit.js (after warmOwnTiles).
- **At launch the region's tiles within 15 km of you are kept on the phone** (once; none inside Cincinnati, whose tiles
  ship in the app; a few MB elsewhere), so a plan near home never waits for its tiles and works offline. Undo:
  `OWN_KEEP_KM` = 0 (cockpit.js).
- **The Log's page no longer loads in the background while you plan** (it loaded 5 s after launch, often mid-plan,
  parsing 40 scripts on the planner's thread); it waits until the plan is over. Undo: the `busy` line in prewarmLog.
- **Avoid towns: the card waits 0.4 s at most for the map's town data**, then says towns aren't known; the check after
  the card looks again with more time and can still swap the route. **Prefer crew roads: 0.3 s** for your crews'
  routes, then the plan goes on; they're used from the next plan. Undo: townsOn's `ms = 400` and `PREFER_CREW_MS` (cockpit.js).
- **A route put back after the page reloads never replaces one you planned meanwhile.** On a weak signal the old route
  came back seconds later, over your new one. Undo: the `plannedRoute ||` line in restorePlanned.
- **Where to? matches your pinned and recent places as you type, first and at once** (no network). **Enter before the
  list is up** goes to your place by that name if there is one, else waits up to 1.5 s for the map search already asked
  for what you typed and takes its top row (as Enter does when the list is up), and only then the full address search.
  Enter on a saved route at the top opens it, as Go did. Undo: `goTyped` back to `routeToQuery` (cockpit.js).
- **The top suggestion's road tile is read while you choose**, so the plan starts with it. Undo: `warmPlace`.
- **A new test plans with every request off the app hanging** (a weak signal) and fails if the card takes more than
  1.0 s after reopening the app or 0.7 s after, or a first launch can't plan. Loosen: the numbers in e2e/smoke.js
  "weak signal".

## 2026-11-08: What the levels mean: Quick is the normal route, Fun never on the highway (claude/level-rules)

Your words: "fun should never go on the highway. Quick should essentially be a normal route i suppose". On your work to
home trip Fun was +8 min and Long way +13, most of both on the Cross County freeway.
- **Quick is the quickest way, highways and all, as any nav app drives it.** A nicer road only when it costs a minute or
  less (it was a tenth of the trip plus a minute). One visible change: Colerain at Quick now takes Colerain Avenue, the
  quickest, where it used to take Pippin and Struble Roads for 1.4 min more. Undo or widen: `quick: { budget: 0, slackS:
  60 }` in web/fun_route.js LEVELS (and LEVELS_COPY in graph_router.js); slackS 90 brings Pippin and Struble back.
- **Fun and Long way never drive a motorway, a trunk road or their ramps.** A hard rule, not a cost: our router never
  enters one (the plan, the first route on screen, the alternates, a reroute of the route, every loop leg), and the
  ranking drops any route that uses one when one that doesn't exists. Valhalla, where our tiles don't reach, is asked
  with use_highways 0. Long way is the same with its bigger budget. Undo: `K.NO_HWY` in graph_router.js and `noHighway`
  in fun_route.js LEVELS.
- **The one exception:** where no way without a highway exists in the level's reach (a river crossed only by an
  interstate bridge, a start or end on a ramp, a car on the highway being rerouted), the shortest highway link (each
  highway second costs 25), and the card says it first: "Uses 0.4 mi of I-275 (no other way across)" ("(you start on
  it)", "(the end is on it)"). Loops say "· uses 0.3 mi of highway (no loop here without it)". Tune: `K.HWY_LINK_X`.
- **No highway-free way in a sensible time** (more than twice Quick's time): still no highway; the card says "No
  highway-free way in a sensible time; Quick is the way" and the Quick card is one tap. **Your work to home trip is this
  case**: the quickest way without the Cross County and I-275 is 44 min against Quick's 21 (2.07x, Sharon, Dry Ridge, Day
  and Struble Roads), so Fun and Long way both show that 44 min route with that line. If you'd rather it showed Quick's
  route there, or the limit was 2.5x, say so. Tune: `K.HWY_ABSURD` and fun_route.js `HWY.ABSURD`.
- **A point next to a highway is reached by its own street** (snapped to the nearest other road within 150 m), unless
  it's a moving car within 25 m of the highway: that car is on it. Undo: `snapOff` in graph_router.js.
- **Fun's budget is still measured from Quick's time**, and never so tight it shuts out the quickest way off the highway
  (that way + 1 min is always allowed). So Fun can't take more than about a third over Quick unless the highway-free way
  itself does.
- **A loop leg that arrives on a street meeting only the motorway turns round there** (a U-turn's 30 s) rather than
  taking the motorway one junction. Undo: the `back` block in `loopLeg`.
- **The "Over the 15 min route" line no longer names a highway route** as the one that beats a Fun pick: the pick keeps
  off it by the rule. Undo: `offHwy` in cockpit.js optionOnto.
- Not covered yet: expressways mapped as ordinary `primary` roads with `motorroad=yes` (our tiles don't keep that tag; a
  tile rebuild would). Trunk roads are covered.

## 2026-11-08: TestFlight notes of 2026-11-05 (build 592.1): crews dashboard, typing in sheets, your photo, the stage page, Ways to go, the deck (claude/feedback-1105)

Your six screenshot notes, each fixed; the calls made on the way:
- **In two or more crews the Crews side is a dashboard** ("Shouldn't it maybe just be a dashboard like the facebook groups
  you're in, with a feed and the option to pin crews?"). A row a crew: its crest and stripe, its name, its next drive, or
  else its last message, or else what it is, and how long ago; a pin key on each. Pinned crews first, in the order pinned;
  the rest by latest activity, then by name. Under the list, "Latest from your crews": the newest messages and drives
  planned across all of them (two weeks, 8 shown, then Show more); a tap opens that crew. A crew opens with "‹ Your crews"
  to go back, and its gear. The old row of crew-name chips is gone. Undo: in cockpit.js renderPeople, `many` to false (the
  crew page then shows alone, without the chips; reverting the commit brings the chips back).
- **In one crew the Crews side is still that crew's page** (a dashboard of one is a step for nothing). Undo: `many` to
  `myCrews.length > 0`.
- **Pins are kept on the phone only** (localStorage `apex.crewPins`): no migration, nothing new on the server, and a pin is
  your own sorting, not something the crew sees. They don't follow you to a second phone. Upgrade: a `pinned` column on
  crew_members and a PUT, if you want them everywhere.
- **The feed is one new read-only Worker route, `GET /api/crews/feed`** (backend/src/crew_page.ts crewFeed), with the same
  rules as each crew's chat and drives: members only, blocked people left out both ways, reported items down, cancelled
  drives out; nothing new collected or kept. Until the Worker deploys, the dashboard lists the crews and says the latest
  couldn't be loaded. Undo: drop the route; the dashboard falls back to that line.
- **Sheets with a text field stand on the keyboard** (Find or start a crew, Invite, every Garage setting, the confirm
  sheet's name field): they end at the keyboard's top and may grow to just below the island; the field scrolls into view.
  Start a crew is now in the order it is filled in: the name (full width), Who can join with its explanation on its own
  line, then a solid Create crew. Undo: the `html.kb-open .side-pop.open` rule (index.html) and `html.kb-open
  .confirm-sheet` (controls.css).
- **Your photo is the key** (Garage, You): no photo, a tap opens the picker; with one, a tap opens Choose a new photo /
  Remove photo / Cancel (the focus on Cancel, never on Remove), with a small pencil on the photo's edge so it reads as
  tappable. The "Photos lose their location data" line is gone from there; the toast after an upload still says it ("Photo
  added. Its location data stayed on your phone.") and the privacy policy is unchanged. Undo: `ApexPhotos.mine` in
  cockpit.js back to the picker row.
- **A stage's runs: a run is a line (#, run, Score, time) with its four components under it**, so nothing scrolls sideways
  on a phone; an empty board is a sentence above the table, not a cut table cell; a friend with no handle is "A friend with
  no handle yet" (it was "@null"), under "Share this stage with a friend". Undo: analysis.html renderSegments / drawBoard.
- **A sheet sliding up is never scrolled for its focused key while it slides** (keyboard.js): that scroll was the "glitched
  animation" on Ways to go (WebKit held the sheet about 360 pt above its place for the whole slide, then dropped it). Ways
  to go also focuses with preventScroll. Undo: the `settle` listeners in keyboard.js.
- **The idle map's deck is the suggestion and one road** (it was two roads), and **a swipe down on the bar folds it to the
  bar alone** (kept on the phone, `apex.deckMin`); a swipe up brings it back, the next opens Where to? as before. Nothing is
  lost when folded: Best roads nearby, the loop and your roads are all in Where to?. Undo: the `2` back to `3` in
  paintDeck's YR.deck call; `setDeckMin` and its two lines in the bar's release.

## 2026-11-08: Own routing, instant: speed limits offline, Valhalla down (claude/own-routing-instant-2)

Your goal: "Planning in well under a second. Routing that works offline. No dependence on a free server that can slow
down or go away. Valhalla would stay only as a backup and for turn instructions."
- **On our routes the speed limits come from our tiles, not Valhalla's map matching.** The limit sign, the strip and
  the arrival time read each road's posted limit from the tiles the route was planned on, so they work offline and with
  Valhalla down. A road the tiles have no posted limit for (or only a guess from the road's class) shows no limit, the
  same as map matching says for it. Routes off our tiles (a GPX file, a route Valhalla planned) still ask Valhalla.
  Undo: the `ownRouteOfTrack` block at the top of attachLimits (cockpit.js).
- **The plan reuses the first route's search** when it is asked for the same trip on the same roads (the quickest is the
  same search either way; members' data and your taste don't change it). Same routes, about 0.07 s sooner. Undo: the
  `memo` line in graph_router.js plan().
- **The towns along our routes are looked up while the route context loads**, not after it; Valhalla's check routes
  that join later are looked up on their own. Undo: `ownTowns` in cockpit.js funRoute.
- **The speed limits are laid on the route just after the card shows**, in their own step, not before it.
  Undo: the `setTimeout` await in attachLimits.
- **Loops where our tiles have them no longer ask Valhalla's map matching for their road data** (the tiles carry it, as
  for routes since 2026-11-04). With Valhalla hanging, a loop's card waited for it: 2.9 s, now 0.6 s. The map's stage
  loops in the same plan are scored the same way, so the two kinds compare fairly. Undo: `L.ownTiles` in buildLoop
  (cockpit.js), or drop the `['router']` skip in loopScored.
- **A new test plans with Valhalla and OSRM down** (every request refused, then every request left hanging) and fails
  if the card is slower than 1.0 s on the first plan or 0.7 s after, the first route slower than 0.4 s, or the turn
  instructions or limits are missing. A loaded test machine could trip the times. Undo or loosen: the `700 : 1000` and
  `400` in e2e/smoke.js "valhalla down".

## 2026-11-07: Own routing, instant and offline; Valhalla only as backup (claude/own-routing-instant)

Your goal: "Planning in well under a second. Routing that works offline. No dependence on a free server that can slow
down or go away. Valhalla would stay only as a backup and for turn instructions until we build our own."
- **The card no longer waits for members' measured roads.** Our search used to wait up to 1.5 s for them (signed out it
  still asked, and the server said "sign in" 0.2-0.3 s later on every plan). Now: signed out, not asked; signed in, kept
  per 0.1° cell on the phone (asked again after 30 min, used for a day, offline too), and what isn't in within 0.25 s
  is planned on what was kept; the fresh answer goes into the whole-corridor plan after the card, which can then swap
  the route (the 5-point rule below). Nothing new is sent: still only the cells a plan crosses. Undo: `OWN_CROWD_MS`
  (cockpit.js) to 1500 and `ownCrowdOn` to always true.
- **When our quickest is the pick, the route already on screen is the final one** (no second build and draw of the
  same track), with its alternates on the card. Undo: the `kept` line in cockpit.js funRoute.
- **The first plan gives the corridor's tiles 0.7 s to load** before it plans on the straight line's tiles alone (a
  plan on too few tiles can miss the quickest way, and so judge the level's budget wrong: Harrison cold picked a 37 min
  route against a 27 min one). Undo: `OWN_FIRST_WAIT_MS` = 0.
- **The refine after the card may now replace a route that the whole-corridor plan shows is over the level's budget**
  ("Quicker way found: switched to ..."), whatever the 5-point margin. Undo: the `gone` line in ownRefine.
- **Loops: ours go up first.** Where our tiles have loops, the card is built from them alone; the map's stage loops
  (Valhalla's matrix and legs: seconds on the public server, nothing offline) are built after the card and replace ours
  only when the level ranks one of them first ("Better loop found on the map's roads"); otherwise they join the other
  levels' cards. Undo: in buildLoop, `await loopRound(L, [...own, ...await stageJobs(true)], ui, true)`.
- **A reroute, a road from Best roads nearby, a suggestion, a road someone sent, Drive it again and a link's or GPX
  file's stops are routed on our tiles** where they cover every point (quickest between the points, offline too);
  Valhalla only off our tiles or when ours fail. Valhalla's spoken maneuvers still swap in when they come. The traffic
  detour stays on Valhalla (it needs Valhalla's "avoid these jams" polygons; it needs the network for traffic anyway).
  Undo: `routePoints` back to `valhallaRoutes` (cockpit.js).
- **No signal, the card says so:** "No signal: the weather and live road events on this route aren't known." (it used
  to hide the weather line, which read as "no weather worth saying"). A forecast server that answered with nothing:
  "Weather: not known (no forecast came back)". Undo: the `!json` block in attachWeather.
- **A second route-analysis worker** (curvature, sight, braking for a route's track), started with the first, on phones
  with 4+ cores: a track built ahead that the ranking didn't pick no longer queues the pick behind it. A few MB of
  memory. Undo: `prewarm` / `routeWorker` in analysis_client.js.
- **Pure speed-ups with the same answers:** local time cached to the minute (it was 75 ms of every ranking on a 30 km
  trip), an engine evaluation reused when the same candidate is ranked again with the same inputs (the level cards rank
  the pool three times), each route's light geometry made in the routing worker, and a track built ahead skips the
  page's turn.
## 2026-11-06 (later): Destination picks (your work-to-home report)

What the card showed: the pick 35 min / 28 corners, a 34 min / 30 corner option that lost, the 22 min highway. Re-run
live at all three levels (our tiles produced every candidate; the context was known on all of them). The 35 min pick is
the Long way route, mostly the Cross County freeway, then two county roads; the 34 min option is the same roads by
I-275. The pick won on the low sun (westbound at 4 pm: 1.6 minutes into it against 8), which is real, but
the card never said so. And 13 of its 14 "good corners" were counted on streets lined with houses.
- **Corners between houses count less, down to nothing on a street lined with houses.** Where two of the engine's built
  signals agree (density, addresses, buildings, sidewalks, shops, class) on 0.4 a corner starts to lose its weight, at
  0.85 it has none. One signal alone (a rural road's barns) doesn't count. Our router uses the same cut from the tiles.
  On your trip: the Long way pick's good corners 14 -> 10, the Fun pick's 12 -> 9; on the trips with real back roads
  (Harrison, Colerain) they barely move. Undo or tune: `BUILT` in web/fun_route.js (cut 0 turns it off).
- **Flow and "not dull" now obey the corner gate too.** Half the fun score counted every corner on a side street in
  full (only Twist was gated). Undo: the two gated lines in fun_route.js score().
- **A pick another option beats on the card's own numbers says why**, on the why line: "Over the 34 min route: less low
  sun". The card never shows a pick that looks strictly worse without a reason. Undo: `overLine` in cockpit.js optionOnto.
- **Fun or Long way picking the quickest says so**: "No great roads on this trip: Quick is the way" (or "The quickest
  way is the best road here too" when it has 5 good corners or more). Undo: `quickLine` in optionOnto.
- **Our router offers cheaper ways to the same road**: after the search for the most good road the budget buys, it tries
  0.9 and 0.75 of that weight, so the engine sees the 7-minute way to the same county road and not only a 9-minute
  I-275 loop. Undo: `K.LOWER` in web/graph_router.js ([] off).
- **A background refresh that switches to a route found only by the wider search says "Found a better way"**, not
  "Conditions ahead". Undo: the `added` check in cockpit.js ownRefine.
- **Kept: Fun and Long way still take the county-road way on that trip** (+8 and +12 min). Their parts: about 5 km of
  rural road with real corners (quality 0.66-0.69, built 0.2-0.3), and skipping a signal, a strip and a dense stretch
  at the quickest's end (quality 0.27). The why line now names them. If you'd rather Fun stayed
  on the highway here, say so: the lever is the side-street cost per km against Fun's 1 point a minute.
- **The live captures that reproduce your trip pass close to your addresses, so they stay out of the repo**; the regression
  tests use synthetic roads at public coordinates (tests/test_dest_picks.py) and the existing public live fixtures.

## 2026-11-06 (later): The route card's levels are the choices (claude/level-cards)

Your note on the 90 mi loop's card ("quick, fun and long way are separate from the cards above? how the hell does that
work?"). The coordinator decided one control; these are the calls inside it.
- **One control: three level cards, Quick, Fun and Long way**, each showing its own pick of the routes already found
  (time and corners). A tap puts that route up straight away, nothing is planned again; the separate route tiles and
  the Quick / Fun / Long way switch are gone. Undo: revert the branch (web/index.html `#routeCardFun`, cockpit.js
  `paintLevelCards`, `takeLevel`, `destLevels`, `withLevels`, route_card.js `levelCards`).
- **Two levels that pick the same route are both lit**, not merged into one card, and the line under the cards says so
  ("Quick and Fun pick the same route", or "All three pick the same route"). Three cards that never change shape keep
  the one you tapped under your finger; a merged card would move them sideways. Undo: `on` in route_card.js levelCards.
- **Long way after a plan at Fun (or Fun after a plan at Quick) says "Look further"** with no numbers, and a tap on it
  plans again, as the switch did. A Fun plan doesn't look for Long way's longer detours, so showing the Fun pool's best
  as "Long way" would pass off a route nobody searched for. Loops always have all three (their loops are all built).
  Undo: `destLevels` in cockpit.js (rank the pool at every level).
- **The sideways swipe stays and now says what it does**: a line under the cards, "Swipe the card for the next route,
  2 of 3". It steps through the cards' routes in their order, then up to two other good routes your level found
  ("Another route found, 4 of 5"; no card is lit then). Swiping onto a level's route takes that level, as a tap does.
- **Map labels no longer pile up**: viewpoint, café and fuel stamps that would overlap hide as the map moves, keeping
  the most useful few (named viewpoints first, then viewpoints, cafés, fuel; each kind spread along the route; at most
  6 viewpoints, 4 cafés and 4 fuel stops on screen at once). Undo: `declutter` in web/scenic.js (`KEEP`, `PAD_SAME`).
- **Fixed on the way: the "weather ahead" swap on our own routes never happened** (ownRefine handed useOption a copy
  of the options it always refused). It now swaps when the refined ranking finds a clearly better route (5 points), as
  intended. Undo: the two `routeOptions = n` lines in cockpit.js ownRefine.

## 2026-11-06: Loops off the highway, from the best roads

- **What a loop is (your words):** any route that starts and ends at the same place, keeps the distance driven twice
  low, and is built from the best roads within reach of the time or length you asked for. It does not need to be a
  circle, and nothing in building or ranking loops rewards roundness any more.
- **Our router's loops are built from the best roads, not rings.** It takes the best-scored roads within reach from our
  tiles (the same ones Best roads nearby lists), and chains one, two or three of them back to the start: a lollipop, a
  figure-eight, out on one good road and back on another. The rings round the start are only the fallback where no such
  loop exists (downtown, for instance). Undo: `rings` as the only source in graph_router.js `loop`.
- **The circle loop from Valhalla is the last resort**, only when no other loop was built or all of them failed.
  Undo: push `circle()` into `jobs` unconditionally in cockpit.js `buildLoop`.
- **Highways on a loop are a short link at most.** Our router costs motorway and trunk ×2.5 at Quick, ×3 at Fun, ×4 at
  Long way on every leg of a loop. Valhalla's loop legs and the matrix between a loop's roads ask `use_highways` 0.25 at
  Quick and 0.1 at Fun and Long way (they used 0.6, "highways welcome", which let highways carry half a loop). Undo:
  `LOOP_HWY_X` in graph_router.js, `LOOP_USE_HIGHWAYS` in route_engine.js.
- **The ranking charges a loop for its highway share**: 1.5 points per % beyond a tenth at Fun, a twentieth at Long way,
  and 1 point per % beyond a quarter at Quick. The engine scored highway as good, smooth road with no side streets, so
  before this change a loop that was 80-93 % highway won. Where the road class isn't known, nothing is charged
  (unknown stays unknown). Undo: `LOOP_HWY` in fun_route.js.
- **A loop beaten on both corners and time never wins**, at any level (your 90 mi Long way case: C at 2:03 and 89
  corners was picked over A at 1:53 and 118). This applies only when the better loop doesn't have more of it driven
  twice (5 % slack), more of it on highway (5 %), or isn't much further off the length you asked for (20 % slack, so a
  28 mi loop isn't the answer to a 15 mi ask just because it's quicker than a slow 15). Why C won before: on a 90 mi
  loop the corner score is a per-km rate of about 10-20 points, so 30 more corners added 4-8 points, while closeness to
  90 mi and the road-quality terms were worth tens of points. Undo: `loopDominates` in fun_route.js `loopRank`.
- **A loop cut to almost nothing is dropped** (under 30 % of the asked length after its spurs are cut). In production a
  0 km "loop" from our router won a 15 mi Fun ask. The cause: the spur cutter looks 400 points ahead, which on our
  router's sparse lines was the whole loop. Lines are now made even (5 m) before spurs are cut. Undo: the
  `resamplePolyline` line in `buildLoop`.

## 2026-11-04 (late): Best roads nearby never a neighbourhood; a Satellite layer for the two of you

Your report: the top pick near you was a residential neighbourhood. On your point the map's stage search (what the app
used before our tiles, and still uses where they find nothing) put Lafayette Avenue through Clifton first: residential all
along, 57 addresses per km, posted 25 mph, our tiles' quality 0.10, but 10 good corners. Corners counted; what the road is
didn't, unless the live context happened to answer in time.
- **A neighbourhood street is never a best road.** Residential, living-street or service class with houses every 25 m,
  density 6+, or a posted 25 mph among houses (fun_route.js `STREET`). Class alone never counts (county lanes tagged
  residential stay: Second Creek Road, Big Cedar Road). Undo: `streetSample` returns null.
- **Where our tiles cover a map stage, a road our model scores under 0.45 isn't listed** (the bar our own search already
  had). Undo: the `'poor'` line in route_engine.js `rescoreStages`.
- **Dead-end spurs are cut, long dead-end roads stay** (the coordinator's call over my first version, which dropped every
  road that ends): a stage's end that runs into a dead end is cut back to the last junction, unless that dead-end run is
  2 km or more of good road, the length a stage needs anyway. Cook Road (2.8 km), Mudlick Road and Second Creek Road
  (2.3 km) stay as out-and-back roads. Streets, service and destination-only roads are never in a stage, so their dead
  ends never count. 3 km was asked for "tunable"; at 3 km Cook and Second Creek still dropped, so 2 km. Tune:
  `OUT_BACK_KM` in graph_router.js; undo the cut entirely: `cut` in `explore`.
- **Loops take neither** (merged with #302, whose loops are built from these stages): a street is never a stage, and an
  out-and-back road (`deadEnd`) is left out of loop chains, since a loop through it drives it twice; the map path's
  loop shortlist skips `notRoad` stages too. Undo: `!s.deadEnd` in graph_router.js `loopCombos`, `s.notRoad` in
  fun_route.js `loopShortlist`.
- **The list shows only stages the engine checked** once it checked any (the first 12), so an unchecked 13th can't fill in.
  Undo: `looked` in fun_route.js `exploreShortlist`.
- Not fixed: outside our tiles, or with own routing off, when the live context is too slow to say, a neighbourhood is
  unknown and can still be listed.
- **Satellite in Layers, for you and @fish5spd only.** The server says `developer: true` in `/api/me` to the owner
  (`OWNER_EMAIL`) and to his address's fingerprint (the same one tools/crash_logs.py follows his notes by). If his Google
  or Apple sign-in address differs from his TestFlight one, he won't get it: add his sign-in address's fingerprint to the
  Worker var `DEV_FINGERPRINTS` (OWNER_TODO). Imagery: USGS The National Map (public domain, US only, sharp to zoom 16),
  under our roads and routes, the base map's labels on top. No migration. Undo: drop `developer` from `/api/me`.

## 2026-11-04 (evening): The weather word on the map

- **"Dry" only when the last 3 hours are known to be dry; rain comes from a real weather station first.** You: "it's been
  raining all day and is currently raining and it says it's dry out". The map's plate turned Open-Meteo's current
  weather code into a word, and codes 0-3 (clear to overcast) all read "Dry"; at the time it said overcast with 0.0 mm
  this quarter hour while its own past hours had 3.4, 0.2, 0.5 and 1.5 mm and the Lunken station reported light rain.
  Now: the freshest of the nearest three NWS stations' observations (90 min at most) names falling weather first; then
  the forecast's code when it names weather; then rain this quarter hour; then **"Wet roads"** after 0.2 mm or more in the
  last 3 hours; "Dry" only when that is known; else nothing. NWS (api.weather.gov, public, no key) gets the position
  rounded to about 1 km, as Open-Meteo already did; privacy.html and licenses.html say so. Undo: `weather` in
  web/place_plate.js and the `nws` lookup in cockpit.js refreshPlacePlate.

## 2026-11-05 (night): Planning with our tiles, the speed round

- **The route card is final as soon as our tiles have ranked the routes**, with the weather and events as last
  fetched for the area; fresh weather and events arrive after and swap the route only when another is clearly better
  (5 points), and the card says why. Undo: `ownRefine` and `OWN_SWAP_POINTS` in cockpit.js.
- **Best roads nearby comes from our tiles** where they cover you (no map tile search, no Valhalla matrix).
- **Graph tiles are served compressed** (as text: the edge only compresses text types). Undo: web/_headers.

## 2026-11-05 (later): Our tiles see side streets; planning under 1.5 s

- **The new tiles carry businesses, driveways, signals, sidewalks and density per road**, and the ranking reads them as
  the live model does: all 10 test trips now pick at least as well as production, the Pippin Road subdivision trip
  included. Table in OWN_ROUTING.md §8.
- **The ranked route is up in 0.8-1.5 s** in a warm session (was 1.2-1.8 s). The ranked route waits 0.4 s for the land
  cover beside the road, then uses the cautious sight distance; the full one is there on the next plan. Undo:
  `OWN_SIGHT_MS` in cockpit.js.

## 2026-11-05: Planning with our tiles, faster

- **Our quickest route goes up first** (about half a second), before Valhalla answers; Valhalla's turn instructions
  replace ours on it when they arrive. Undo: `ownQuickP` in cockpit.js funRoute.
- **Our routes are ranked with the tiles' own road scores** plus the time-dependent data only (weather, wildlife,
  events, live hazards, the national grid), in 0.9 s instead of 4 s. This moved 5 of 10 test picks; on full data 9 of
  10 are still at least as good as production, one (a short trip by the Pippin Road subdivision) is worse until the
  graph builder bakes in the router's density and driveway data (OWN_ROUTING.md §8). Undo: `OWN_CTX` in cockpit.js.
- **The tiles round you load at start** (bundled, kept in IndexedDB). Off on one phone: localStorage `apex.ownWarm` = "0".

## 2026-11-04 (night): Our own routing on the real Cincinnati roads

Live on 10 trips, our router's pick won the engine's ranking on all 10 and scored at least as well as production's
on 9; the tenth is the same route as production's, scored at a different hour (OWN_ROUTING.md §8 has the table).
- **Fun and Max now really trade time for road**: the cost is `time x exp(a x badness)` (the multiplicative form could
  never buy more than about 9 % more time here), and corners carry most of the goodness, so the motorway's high
  quality no longer pulls Fun onto it. Undo or tune: `K` in web/graph_router.js.
- **One clock**: where Valhalla's route and ours are the same way, our times are put on Valhalla's clock (ours ran 12 %
  slow), so a Quick plan doesn't lose a route to its own copy. Valhalla's highway-friendly route is asked again as a
  check for this. Undo: `oneClock` in own_routing.js.
- **Members' data counts per stretch inside the search**: measured roughness, flow, loved roads and banking change
  each edge's goodness with the route engine's own weights. Signed out: no change. Undo: `crowd:` in cockpit.js funRoute.
- **Via-way turn restrictions are not applied** (259 here): the tiles don't carry them yet (a gap in OWN_ROUTING.md).

## 2026-11-04 (evening): Our own routing on the phone (the router half)

The phone can now find routes itself over our own scored road network (docs/OWN_ROUTING.md §5, §8). It does nothing
until the Cincinnati tiles ship: where no tiles cover a trip, planning is exactly as before.
- **Where our tiles cover the trip, our routes are the candidates** and the stage search, its matrix and the
  highway-costed router call are skipped; Valhalla's quickest stays in the pool as a check, and is waited for at most
  2.5 s once ours are in. Undo: `ownCovered` in cockpit.js funRoute, or the flag below.
- **One switch:** the `own_routing` flag (on; it only acts where tiles exist). Off for everyone: FLAGS
  {"own_routing":{"on":false}} in the Worker's variables; one phone: localStorage `apex.ownRouting` = "0".
- **Fun and Max fun trade time for good road** as `time x (1 + a x (1 - goodness))`, `a` found so the route stays
  inside the level's time budget (the same budgets as today); goodness is half quality, three tenths corners, a fifth
  scenery, and unknown road counts as below average so it can't win. Every route found on the way is offered to the
  route engine, which still picks. Undo or tune: `K` in web/graph_router.js.
- **Signals and stop signs on a junction are added by the router** (15 s and 7 s, the graph builder's own numbers for
  those inside an edge), so each is counted once; OWN_ROUTING.md §3 says so. Undo: `SIGNAL_S`, `STOP_S`.
- **Turn instructions for our route come from Valhalla's trace_route** on our line when online (one request, 3 s at
  most), our own from name changes and turn angles offline. That sends the route's line to the public router, as the
  road-data provider (router_edges) already does for every candidate; nothing new leaves the phone. Undo:
  `ownInstructions` in cockpit.js.
- **Our routes are always pinned with shaping points**, so a reroute (still Valhalla's) keeps to them.
- Not done: the live comparison against production (no real tiles yet), Explore on our router.

## 2026-11-04 (own routing): the region on the free tier

- **Audit: the first region build (2026-45-95960e6d) was scored with the Cincinnati grid only** (its band logs: "grid
  bundles 4"), so outside Cincinnati noise, night lights, canopy, housing, impervious, AADT/IRI and crashes were
  unknown in the scores. The rebuild after ctx-region.yml (2026-45-95960e6d-gebab6b, "grid bundles 33") has them: on a
  random 60 tiles (29,023 roads) the share with a known value went 0 -> 100 % for noise_db, night_lights,
  impervious_pct and crash_density, 0 -> 99.5 % housing_density, 0 -> 28.2 % aadt (HPMS counts main roads only).
  graph-region.yml now warns when it has to fall back. Order: ctx-region.yml, then graph-region.yml.

- **The shipped Cincinnati tiles are cut from the region build** (tools/graph_etl/bundle.py, run by every region
  build, committed to the triggering branch, or to `claude/graph-bundle-<build>` for a PR when that is main), so the
  phone uses them first and offline works from first launch. graph.yml no longer builds Cincinnati on its own. Undo:
  the bundle step in graph-region.yml.
- **The context grid for OH+KY+IN is on the graph-data branch too** (ctx/v1, .github/workflows/ctx-region.yml, six
  shards), and /api/ctx/v1/ reads KV first, then that branch. The graph build scores with it when it is there; the
  build id says which grid (`-g<hash>`), so a rescore is a new build.

- **The OH+KY+IN road network is hosted on a `graph-data` branch of this repository**, relayed by the Worker at
  /api/graph/v1/ from raw.githubusercontent.com behind the edge cache (no R2, no KV, no secrets: the owner wants no new
  costs). Each rebuild is a new commit on that branch (the repository grows by the region's size each time; old builds
  can be dropped later by deleting and re-creating the branch, which only the owner may do). Undo: delete
  backend/src/graph.ts's routes and the branch.
- **The region is built in parallel bands of 1 degree blocks**, each from its own extract with 0.4 degree round it, and
  edges in a tile are ordered canonically, so blocks agree on the tiles they share; one build id for all.
- **The shipped Cincinnati tiles are used first only while the region has the same build** (else the region's, kept in
  IndexedDB, with the shipped copy as the offline fallback): mixing two builds would join edges to the wrong nodes at a
  tile edge. Undo: `order()` in web/graph_tiles.js.
- **Via-way turn restrictions are applied** (format v3) where the path is simple; most in the data run through motorway
  crossovers that aren't drivable and need nothing.

## 2026-11-04 (own routing): the scored road network (graph half)

- **Side-street evidence in the tiles (format v2)**, after the router builder found tile-only rankings rated suburban
  streets too high. Against the live engine on the calibration roads (each sample matched to its tile edge) the tiles
  read 0.04-0.10 high on suburban roads. Fixed: road density now counts every vehicle way, driveways and car-park
  lanes too, as Valhalla's graph does (it had counted only the routable, trimmed graph); businesses within 80 m, as the
  live engine counts them (40 m missed shops behind their car parks); footway=sidewalk lines give `sidewalk`; addresses
  count. Springdale Rd now 0.31 vs the live engine's 0.30, Pippin 0.37 vs 0.33, W Kemper 0.28 vs 0.28. Pippin Road is
  low in the live engine too (homes along it): it is reported, not gated. Undo: `DENSITY_KNOTS`, `BUSINESS_M`.

- **Every road is scored once, ahead of time, by the app's own model**: tools/graph_etl/score_edges.js runs
  web/route_engine.js, fun_route.js, dem.js and context_grid.js in node on each edge; the Python side only measures
  (OSM tags, counts, land use, density). No second model to drift. Undo: delete tools/graph_etl and web/data/graph.
- **Per-km counts use the road's own continuation, ±500 m**, across junctions (same name, else under 50° of turn), so a
  60 m edge between two side streets reads like the road it belongs to, as the router's ±500 m windows do. Undo:
  `WINDOW_M` / `Graph._continuation` in features.py.
- **Road density is computed, not asked**: road km per km² within 2 km, mapped to Valhalla's 0-15 by the medians on the
  calibration fixtures' 2055 router edges (r = 0.95). It decides when a "residential" road is a TIGER county lane.
  Undo: `DENSITY_KNOTS` in build.py.
- **Travel time is our own simple model** (posted limit or the app's class estimate x a class flow factor, corners at
  0.3 g, signals and stops inside the edge); signals and stops at an edge's ends are left to the router's turn cost so
  they are never counted twice. Undo: `FLOW`, `MU_TRAVEL` in score_edges.js.
- **Bollards and locked gates are dead ends from both sides** (each road ending there gets its own node); open gates
  are a flag. Undo: the barrier block in osm_graph.build_chains.
- **Car-park lanes are left out to fit the app**: the first Cincinnati build was 26.5 MB (598k edges, 40 % unnamed
  service roads). Unnamed service roads and tracks that meet no public road (the lanes inside car parks and campuses),
  and unnamed dead-end service stubs under 200 m (a lot's entrance), are not routable; they still count as driveways
  and joins. A destination there snaps to the street in front. Named and longer service roads stay. With the tighter
  tile layout (u16 node coordinates and lengths, 0.5 m geometry steps) the 16 tiles fit the 15 MB target. Undo:
  `trim_service` / `STUB_M` in build.py.
- **The tiles are ODbL** (a derived OpenStreetMap database shipped in the app): said on the licences page.
- **Blue Rock Road's spot check is its rural stretch** (north of the I-275 ring, the one the calibration's Blue Rock
  route drives): inside the ring it is a posted 35 mph suburban street and scores like one. Undo: the box in check.py.
- **Via-way turn restrictions are counted, not applied** (index.json `stats`). Undo: none needed; applying them is next.
## 2026-11-04 (evening): The plan flow, simpler

You said planning a route was "clunky and confusing". An audit on production (iPhone 15 size) found eleven problems; all
are fixed. Nothing was removed: every option moved to one place. Before and after screenshots are in the session's
scratchpad (planux/contact_sheet.png and planux/after/contact_sheet_after.png).
- **The card says what the plan is doing.** A progress line ("Finding fun roads · 2 of 2") runs on the card. When the
  ranked route replaces the first one, the card says so in its own numbers: "Better route found: +8 min, 52 more
  corners". If it keeps the first one, it says "Checked 6 routes: this one is the best". Undo: `cardNote` in cockpit.js.
- **Start doesn't move.** Start and Fly-through are the card's foot, outside its scroll. The elevation profile's space
  is kept before it loads, and when no heights come it reads "Heights --". A re-plan keeps the card's scroll. Undo:
  `.plan-foot` in index.html, then put `#routeGo` back inside `#routeCard`.
- **The card opens at half height.** Drag it up for the full card, or down for half and then the bar. Undo: the
  `.plan.open.routed:not(.full)` height rule, and the `card` branch of the bar's drag.
- **The level (Quick / Fun / Long way) lives only on the route card.** Switching re-ranks the routes the plan already
  found whenever they cover the new level. A plan at Fun covers Quick, and a plan at Long way covers both. Switching
  up from Fun to Long way still plans again, because longer detours need routes of their own. The card says which it
  did. Undo: `changeLevel`/`rerank`, and the Roads switch back in the plan sheet.
- **Loops have a level too.** Quick favours the length you asked for. Long way gives more for corners and lets the
  length run (fun_route.js `loopLevelAdjust`; Fun ranks loops exactly as before). The loop card shows its length in your
  units and up to three loops to pick from. Undo: `LOOP_LEVEL`.
- **One Options sheet** replaces More's four groups. It opens from the chip next to Best roads nearby, or from the card.
  It holds:
  - Avoid ✕;
  - Prefer ✓ (the old Prefer and For this drive together);
  - Kinds of corners (Hairpins and Fast bends: Fewer / Any / More);
  - Start from;
  - Loop to fit (1 hour, 2 hours, and in the app My free time and This album);
  - Presets and Open GPX.

  Switches no longer re-plan one by one. Closing the sheet re-plans once, and only if something changed. Undo:
  `closeOptions`.
- **What is on stays in view.** Small chips sit on the plan sheet and the card ("✕ Highways", "✓ Passenger aboard"),
  and any chip opens Options. Undo: `paintOptChips`.
- **Tunnels is under Prefer, not Avoid.** Your brief listed it under Avoid, but the route engine *favours* tunnels
  (route_ctx/driver.js), so under Avoid it would have said the opposite of what it does. Undo: move the button.
- **The 1 h / 2 h loop stops moved from the dial to Options.** The dial now uses one unit, yours: 15 to 90 mi or 25 to
  150 km. Undo: the `#loopDetents` markup and `labelLoops`.
- **The main key follows the task.** With nothing typed it reads Find a loop. Once you type, the loop dial gives way and
  the key reads "Go to <the first place>".
- **Best roads nearby (was Explore in More)** is a chip under Where to? on the map and on the plan sheet. It opens a
  list sheet with named columns: Road, Good corners, Length, Drive there. It shows its last look for 10 minutes.
- **One name for go: Start.**
  - The card's "Drive it" is Start, and the bar's key with a route planned reads Start too.
  - With no route, the bar's red key is a smaller ink "Just drive", and its sheet's Drive is Just drive.
  - The map's deck keys that only plan (Drive, Go) read Plan.
  - Preview is Fly-through.
  - Undo: vocabulary.js `start`, `justDrive`, `flyThrough`.
- **Plain words for a new driver** (vocabulary.js):
  - Long way (was Max fun);
  - Kinds of corners (was Corner mix);
  - ✕ / ✓ (was "stamped");
  - Curvy and Flowing on the dials (were TWIST and FLOW);
  - S-bends, Tight corners, Fast bends and Hairpins in the card's Ahead line (were Esses, Technical, Flowing sweepers
    and Switchbacks; apex_core's names inside are unchanged).

  Sight and Bank keep their instrument names, because the CarPlay screens share them and their one-number test guards
  them. The vocabulary gives each a plain sentence. The route options' tiles count every corner, as the card's CORNERS
  number does ("8 min quicker · 20 corners"), so a route with 20 corners no longer reads "53 fewer good corners".
- **Swipe the card sideways** to move between the alternatives (or tap their tiles).
- **On the website, a re-plan whose fresh GPS fix fails starts from the last known position** instead of saying
  "Couldn't get your location". The app already did this. Undo: the one line in `locate()`.
- Taps (journeys measured in e2e/smoke.js "plan flow" (a)–(g)):

  | Journey | Before | After |
  |---|---|---|
  | A destination | 3 | 3 |
  | A loop | 2 from the map's card (4 through the sheet) | 2 |
  | Best roads nearby | 5, with scrolling | 3 |
  | Change level | 1, then a 10 s re-plan | 1, instant when the found routes cover it |
  | Pick an alternative | 1 | 1 tap or 1 swipe |

- The UI tests (UITests/*.swift) and tools/app_tour.js tap the new names. Only string literals changed. CarPlay
  templates are unchanged; the car's route choices now also list a loop's alternatives.

## 2026-11-04 (evening): OpenStreetMap through our server; a little faster

- **An OpenStreetMap relay on our server is built but OFF** (`/api/ctx/osm`, one 0.05° map square per request, cached a
  week; server flag `osm_relay`, default off). On the preview every public Overpass mirror refused the Worker or timed
  out (`?diag=1`: overpass-api.de 521, kumi and private.coffee timeouts, maps.mail.ru 504), and the own-routing graph ETL
  takes the same features from the Geofabrik extract. With the flag off, phones do exactly what they did before. Turn on:
  FLAGS {"osm_relay":{"on":true}} if Overpass recovers. Undo: delete the endpoint and the osmRelay option.
- **Back-road stage lines are traced through our server too** (`/api/ctx/trace`, cached 3 days): these are map lines,
  never the driver's route. Undo: the relay call in router_edges.js.
- **The first route shows on whichever router answer lands first.** Local live: 2.6-6.5 s, first route 0.8-1.6 s.
- **No early stop**: unknown data could still swing a plan by 77-104 points while the closest real gap is 1.3 points, so
  no plan can be dropped safely.

## 2026-11-04 (later still): The route engine, faster

- **Finding good-road stages runs off the main thread** (a Web Worker, web/stages_worker.js) and is cached 10 minutes
  per area, so the map stays smooth while planning and a re-plan reuses it. Undo: the worker call in stages.js.
- **The first route shows the moment the router answers** (it no longer waits for the highway candidate); the ranked
  route replaces it when ready. Sections, stage plans and their road data now run side by side, with at most 6 road-data
  requests in flight so the public router answers each quickly.
- Live (real services): planning 3.1-6.9 s (was 4.8-11.4 s on production), first route 0.85-1.73 s. Picks unchanged.
- Not done: stopping early once the winner is certain; the bounds on what unknown data could change are too loose to
  drop a candidate safely, so every candidate is still scored.

## 2026-11-04 (later): The route engine, fixed on the live network

A check of the live app on real trips (no saved data) found 4 of 6 wrong picks and 11-16 s planning: the router's road
data never arrived in time for the back-road plans, and the OpenStreetMap search servers fail from a phone. Fixed:
- **Side streets and strip malls cost the whole way** (they were free for 1.2 km at each end) and businesses cost on
  their own, so Colerain Ave loses at every level. Undo: `POOR_PER_KM`, `BIZ_PER_KM` in route_engine.js.
- **Corners only count for the part of a drive that isn't side streets or strip malls**, so a plan that rides an arterial
  to reach good corners can't beat I-275. Undo: the clean-share factor on fun and gain.
- **A back-road plan the router couldn't describe in time is trusted at 40 %**, not in full, and is scored from map
  tiles, land use and the national grid meanwhile. Undo: `STAGE_UNKNOWN_GATE`.
- **The OpenStreetMap search no longer holds up planning**: a plan uses what earlier plans cached, and fills the cache
  for next time. On a first plan in a new area, stop signs, crossings, calming, guard rails, byways and height/width/
  weight limits are unknown (not guessed); ROUTE_ENGINE.md lists them. Undo: `CACHE_ONLY` in osm_overpass.js.
- **Planning 4.4-6.6 s** (was 11-16 s); the first route shows in 1.3-2.4 s.
- **The route card only says what's true**: scenery is never named for a route with more strip mall than the quickest,
  "avoids X of strip malls" counts strip malls only, and a single viewpoint says "a viewpoint".
- **The Log tab's frame was blocked** by the security policy since #267 (`frame-ancestors 'none'`); now same-origin.

## 2026-11-04: The route engine: every free data type in one ranking

You asked for every free data type in the routing, meaningfully, best in class. Five builders made it; an independent review
found a crash, two ranking faults, two privacy gaps and about twenty dead channels, all fixed before this shipped. How it
works, with every weight: docs/ROUTE_ENGINE.md (and the flowchart page).
- **The highway competes again.** The app asks the router to keep off highways, which is why routes cut through
  subdivisions and strip malls. Now a highway-friendly quickest route always competes (unless Avoid Highways is on) and
  connector legs may use highways. Undo: `connectorCosting` and the highway candidate in route_engine.js.
- **Each 25 m gets a road-quality score** from the speed limit, road class, signals, stops, driveways, side roads,
  businesses (not fuel or coffee), land use, housing, built-up ground, night lights, traffic volume and noise. **Corners only count on
  good road**, so a twisty subdivision earns nothing. Tuned on four real Cincinnati choices; undo or tune: `QUALITY`, `W`.
- **A low speed limit only counts against a road when the road is built up.** A 30 mph road through the woods is a great
  road; a 30 mph road with sidewalks and driveways is a side street. Undo: the built-evidence floor in route_engine.js.
- **Unknown data never wins.** A stretch with no data takes the worst known score in the pool, not a free pass.
- **Time matters.** Deer hour, school and church hours, game days, fog in valleys, crosswind on ridges, ice, works,
  floods and harvest are charged for the time you'd be there, each capped on its own so one can't hide the rest; closures,
  private roads and what your car can't fit drop a route.
- **Privacy kept as written:** map-data servers get map squares, never the route line; our server gets 0.1° cells for
  road data, never which roads you're planning. Weather goes by 0.05° cell centres.
- **The planner waits up to 4 s for all the data**; if planning takes over 1.5 s the quickest route shows first and the
  ranked one replaces it. Undo: `EARLY_MS` and the budget in registry.js.
- **New Plan → More stamps:** Passenger aboard, Lit roads at night, Cyclist courtesy, Tunnels. **Garage car:** Fuel and
  Range, for gaps between stations. Calendar and album length can size a loop (asked only at the tap).
- **Busy hours per road** are built but switched off until you decide Quiet hours (OWNER_TODO).
- **Migration 0045** (additive) applied to the preview and production databases before the merge.
- **Keys** that add data when you make them (all free, all optional): OHGO, SeatGeek, Flickr, Mapillary, NREL, plus the
  wider-region data grid's storage; see OWNER_TODO. Without them those sources say "unknown", never guessed.

## 2026-11-04: Sheets swipe down; the drive map zooms; a production deploy that never ran

- **Menu sheets swipe down to close** (you: "i should be able to swipe this submenu out of the way"): a bottom sheet
  follows your finger down from its top and closes past 80 px or on a flick, through its own back/Done key, so a sheet
  over the Settings list goes back to the list. Undo: the swipe block after popScrim in cockpit.js.
- **The drive page's map zooms** (you: "zoom in on it and out but not all the way out just a little extra"): two fingers
  pinch and pan (one finger still scrolls the page), zoom in freely, out one level past the fitted drive, panning held
  near the drive, a Recenter key; it says why when it can't show ("Map unavailable offline" / "couldn't load").
  Undo: `cooperativeGestures` and `limits()` in web/drive_basemap.js.
- **Feedback runs print each note's build** ("build 1.0 (574)") so a note can be matched to what it was seen on.
- **Why the car themes vanished on 574**: #288's production deploy never ran. Right after the merge I pushed this branch
  at main's exact commit, and Cloudflare built that commit as a branch preview instead; the server stayed on #287 and
  sent the old theme format, which 574 rejects. #289's merge deployed it (checked live). I no longer push the branch at
  main's commit after a merge, and I check the live files after each merge that touches the server.

## 2026-11-03: A theme from a newer server falls back instead of vanishing

- The car themes disappeared on 572.1: the server deployed the new `car` renderer at once, and the older app's contract
  rejected a renderer it didn't know, so it dropped both granted themes. Build 574 draws them. From now on a renderer
  the app doesn't know is drawn as the printed dial, g-ball and road book, so a granted theme never vanishes because the
  server is ahead of the phone. Undo: renderersFor in web/themes.js.

## 2026-11-03: The car themes are the cars (you: "much more car specific… any voice pack")

- **Each cluster is drawn as that car's**, from its own data on the server (only your and @fish5spd's accounts get it).
  Tiburon from your photos: black faces, chrome rings, red-orange needles, speedometer left (0-160 MPH, km/h inside),
  the right dial the tach's face (0-8, red from 6.5), the twin small gauges and the LCD, red light at night, silver
  paint. FR-S: the centre 0-9 tach (red from 7,500) with the speed in digits, PACE window, the REV lamp, the right dial
  Turn and Brake, Bank on the left, carbon trim, Ultramarine Pearl. Sources and what couldn't be confirmed:
  docs/design/CAR_THEMES.md.
- **Honest readings**: Vetta can't read the engine, so the Tiburon's tach-faced dial reads grip ("x0.1 g", 8 = 0.8 g)
  and says so; the FR-S tach needle rests dimmed; the small gauges carry Turn and Brake, the LCD Bank. Undo: the
  dial's `reads` in backend/src/private_themes.json.
- **Red** is allowed for needles, redline zones and night light where the car has them (you: "red doesn't need to be
  warnings only"); the warning keeps its shape, hatching and word, which the theme contract now checks. The FR-S needle
  stays white (its stock colour couldn't be confirmed).
- **Your car on the map** is a top-down outline in its paint, on the phone and the car map (road-edge outline for
  contrast); the Garage card is the parked cluster with the car, the share card shows the car by VETTA.
- **Any voice with any theme**: "Co-driver's voice" in the Garage (Suggested, Marguerite, Kit, Hale); the pick wins over
  the theme and survives theme changes. Undo: the voiceChoice setting.
- Not drawn: the Tiburon's warning lamps (a lamp that never lights would mislead), its turn arrows, seat fabric.

## 2026-11-03: End's Undo is 1.7 s (you: "undo timer should be 1/3 as long")

- The Undo after End now lasts 1.7 s (was 5 s), on the phone and the car's screen. Report's and the convoy calls' 3 s
  Undo are unchanged: you said "the undo timer", and End's is the one with the running fill. Undo: END_UNDO_MS.

## 2026-11-03: Four TestFlight notes (#286)

- **Three of your notes from 31 Oct were never seen**: the run read only the last 10 notes. It reads 20 now; these are built.
- **Map under the drive's path** (the Log): the app's own map, loaded when the picture scrolls into view, not touchable;
  no signal and no saved area keeps the blank panel. Undo: drop web/drive_basemap.js from analysis.html.
- **The grip circle explained**: "Your grip on this drive" now reads "The outline on this drive" (it is what you used,
  not the tyres' limit), with a tap-to-open explanation. Undo: the text in drive_view.js ggView.
- **Dashcam preview**: the video shows with the overlay, step from call to call while sliding. Untested on a phone.
- **Convoy while leading (@fish5spd)**: the convoy is one line in the map's bottom-left (behind the car); the leader's
  calls open from Report or a tap on the line. It sat mid-map because the safe area was counted twice. Undo: the
  `#app.live .convoy-bar` rules in convoy_ui.js.
- The flyover video's watermark says VETTA (it still said APEX NAV).

## 2026-11-03: Road data fixed, your tester's three notes, two private car themes (#285)

- **Road data was invisible.** The app's upload dropped each road's line and class, so the server knew no road's type and
  showed none of the 187 roads measured. It sends them now; I filled the 187 roads' lines and classes in from
  OpenStreetMap (public map data, not anyone's drive). Undo: `DELETE FROM road_ways` (then nothing shows until two drivers).
- **Banking zeros were placeholders.** The phone faded camber to 0 on every straight and uploaded it as measured (13,044
  of 14,768 bins). Now camber is unknown unless measured in a corner within the last 1.0 s, rows and uploads carry a
  marker (`camber_v`/`cam_v` 2), and the server stores camber only from uploads with it, so the TestFlight build on
  phones can't add zeros. In production I cleared every stored camber value (the fading made even the non-zero ones
  suspect); roughness, crest and curvature stay. Backup: table `road_bins_backup_20261103` (15,441 rows, 18:44 UTC) and
  D1 Time Travel. Undo: copy camber_mean, camber_m2, camber_n back from the backup table.
- **Road feel** speaks from 40 m of measured corner (banking) and 200 m of roughness. Undo: MIN_BANK_ROWS in road_feel.js.
- **A deliberate detour** reroutes once, forward (the request carries the car's heading), says "Rerouting" once per
  detour, and keeps the plan if you rejoin it. Undo: revert the heading in reroute().
- **Music under the voice:** "While Vetta speaks: Lower music / Pause music" in Layers beside Voice (app only). No voice
  boost: past full volume needs its own gain stage, which can clip, and can't be built safely without compiling. Pause
  pauses for every line, and hands the music back 0.8 s after the last.
- **No glitch on a reroute:** the new route replaces the old in one redraw, the camera doesn't snap, one status
  ("Rerouting…"), the arrival stays up.
- **Two private themes, Tiburon (silver 2005 GT V6) and FR-S (Ultramarine 2013):** their looks live on the server and
  are sent only to accounts in `theme_grants` (yours and @fish5spd's; migration 0044 applied to both databases). The
  Tiburon's pre-2007 dash light colour couldn't be confirmed, so it claims the silver and the centre pod only. Voices
  reuse Hale (Tiburon) and Kit (FR-S). Undo a grant: `DELETE FROM theme_grants WHERE user_id = ? AND theme = ?`.

## 2026-11-03: Feedback runs hourly; your co-developer's notes count as yours

- **Hourly, not daily** (you asked for every 1 or 1.5 hours; a schedule can't say 1.5, so hourly, at :52). A run with
  nothing new does nothing and says nothing. Undo: ask for a different interval.
- **@fish5spd's TestFlight notes are followed like yours** ("anything he says goes as well"). tools/crash_logs.py knows
  him by a fingerprint of the address he was invited with (the address itself is not in the repo) and prints his notes
  "from: co-developer". Any other tester's notes are still counted, never followed; crashes from anyone are still fixed.
  The run now reads the last 20 notes, not 10. Undo: clear `CODEV` in tools/crash_logs.py.

## 2026-11-03: Panel round 2 built (docs/design/panel/round-2/VOTE.md; 20 reviewers, 200 points)

Five builders plus a rig fix. The calls, each with how to undo it:

- **Shut doors open at once (CI caught it).** web/doors.js waited for the next frame after a sheet opened before
  unshutting it. A sheet opened over the Settings list (Crash check) kept its fields inert for that frame, and on CI's
  slower runner the first typing went nowhere. It now updates in the observer itself, before the next tap or keystroke.
  e2e clicks and checks in one task, which fails on the old code. Undo: revert that commit (the race comes back).
- **The recording rig.** Recording 7's four stopped flows were all the rig, not the app: the welcome's label, a planning
  drag that hit the home screen, a car query too broad, and Billet's key hidden under the tab bar. Undo: revert 15c6edf.
- **A, one red.**
  - The route is drawn in ink in Roadbook and Billet; Tapedeck's warning becomes red (#FF4D63 / #F2475E), not orange.
  - Warning words use the warning colour in every theme. The OPEN Sight plate draws nothing on the phone or the car.
  - Undo: `themes.js` and the Swift palette.
- **A, road feel and explain.**
  - The end card's road-feel line and the Log lane show only after 200 m of calibrated bank readings.
  - Explain sheets work only under 3 mph or in a replay.
  - Not built: the cluster's compass and speed-limit settings.
- **Sight, where A and C met.** Sight is the held sight line only, as the map tag shows it; the corner's pace keeps its
  own mark on the dial. This is C's vocabulary rule, so 40 mph against Sight 50 is no alarm. VoiceOver reads it the same
  way.
- **B, voice and sensors.**
  - With the road known, the opener is "<Road>. Full notes."; with it unknown, nothing is said.
  - A short quiet plays the chime alone.
  - A chain names the next corner only within 150 m or 6 s.
  - Idle sensors: 100 m GPS, no IMU or barometer, no background location. The full stack runs at Start, in the car or
    above 8 m/s, and stops after 5 min stopped. Undo: make `updateSensorStack` always return full.
- **C, vocabulary.**
  - `web/vocabulary.js` with a test. "Fun" is only the route style.
  - Notes and Voice live in Layers (the Garage shows a summary).
  - The two red Start keys are a listed known break (SO-2 next round).
  - One distance and corner format (`format.js`): every corner, one decimal under 10.
- **D, the road.**
  - The end card fit is a jump, not a flight, with an SVG road portrait until the map draws.
  - The share card leaves off the first and last 800 m, has no time (a time with the distance would give the average
    speed), and keeps Pace (a 0–100 part, not a speed).
  - Road links carry the road in the URL (after `#` on the web, so no server sees it). There is no road page server.
  - The Log's Share is now "Send the road". Every planned route is fitted whole.
- **E, privacy and access.**
  - Hazard, meet, crew and spot lookups send only the 0.1° cell. None go from a privacy zone or within
    max(1 km, privateEdge) of a drive's start. The server snaps to the cell.
  - Worker invocation logs are off and query strings redacted.
  - Text-size caps are 2× on scrolling pages and 1.6× on the end card and plan controls.
  - Not built: IN-2's large cockpit.
- **Not built (vetoed):**
  - JA-2, silencing the spoken Score;
  - PE-1, the 30-car convoy;
  - JA-3, a public drive link;
  - TO-4, an early Live Activity prompt.

## 2026-11-02: Panel round 1 built (the winners of docs/design/panel/round-1/VOTE.md)

The owner asked for iterative improvements from a panel of reviewer characters who vote (docs/design/PANEL.md). Six
reviewers made 35 proposals and voted. Four builders built ranks 1–6 and the cheap M-2 and P-1. The calls:

- **Your roads and the Sunday suggestion (D-1, R-1, D-2).**
  - Your roads are grouped by drive name, not map-matched road runs, so drives aren't sent to the map-matching server.
    Undo: `roads()` in `web/your_roads.js`.
  - "Not driven yet" reads only the map's tiles and gives straight-line distance, so the position isn't sent to a router.
  - Drive it again routes to the start, then through up to 7 points along the drive's track (turn-by-turn and an ETA). It
    is hidden for drives under 1 km. The deck has at most 3 rows.
  - The Reminder is off by default. Permission is asked when the switch is turned on. It sends at most one a week, the
    evening before your usual day. No streak words (a test checks). Tapping it opens the app, not the suggestion yet.
    APP_REVIEW 4.5.4.
  - Twisty roads is on by default, turned on once for old saves. Dani's ghost loop isn't built.
- **The car card's glance form (T-1, I-4).**
  - Only forms of 24 characters or fewer are sent, cut at a clause or a word, in the call's own words.
  - The Dashboard gets the same list. Undo: `dashboardInstructionVariants = [variants.last]`.
- **End can't be a mis-tap (I-3).**
  - End becomes Undo for 5 s, the drive stays live, and if nobody taps Undo it saves as it stood at End.
  - The car's End shows an Undo alert; a second End ends at once. Siri's end and the parked auto-end end at once.
  - Tapping elsewhere does not end it early, and Report did not move (the gap is now 16 pt). Undo: the
    `askEnd`/`paintEndUndo` block in `cockpit.js`.
- **The call grammar and one notation (M-1, M-2, M-3, P-2).**
  - Plain words put the warning first and use one word per thing: "Careful, hairpin left, long". Acute is "hairpin",
    severity 1 is "tight", and the similes are gone.
  - A chained next corner keeps its own caution ("then careful, square left"). Undo: `plainNamed`.
  - Asides are tagged advice or colour (`ADVICE`). Advice ends a beat before braking. An aside is dropped, never
    deferred, and never follows a call with a link.
  - `noteCode` gives the next cells, car plates, island and Log one notation. Rally codes are now SQ L and LHP, and the
    island shows the grade, which reverses U-103's "R2". Undo: `noteCode`'s rally branch.
  - On a 320 pt phone the head stays whole and the next cell shrinks, then hides (`fitHead`).
- **The app comes back whole, and the rig (D-3, R-4c, R-5, T-6, P-1, D-6 part).**
  - The stuck replay was the rig's lookup ("Done: close the replay"), not the app. The rig now stops a flow that doesn't
    get its tab bar back.
  - The missing Where to? deck was a real bug: it measured its bar while hidden.
  - The end card closes when a tab opens. Billet didn't take because the route load closed the Garage.
  - The guided drive's landscape Report lookup timed out; it is now found upright.
  - A drive with no score shows "4.1 mi · no corners to score" (Dani's card, not Ray's toast).
  - A crew link's first open shows the welcome with a generic line, because the crew-name preview needs sign-in.
- **Not built:**
  - P-3 (Dani's veto).
  - I-1 (disputed, checked next round).
  - R-4's seeded social world and the 1-point proposals (next round).

## 2026-11-01: Vetta on the CarPlay Dashboard (the split overview screen)

- The owner asked for the Apple Maps-style overview: map on the left, guidance top right, music bottom right. That is the
  CarPlay Dashboard. Vetta already declared it (`CPSupportsDashboardNavigationScene`) and drew its map there, and CarPlay
  builds the guidance card from Vetta's navigation session.
- Added:
  - the Dashboard card gets the short instruction first (`dashboardInstructionVariants`);
  - two shortcut buttons shown when not navigating, "Where to?" and "Loops". Apple asks Dashboard navigation apps for
    these. Each opens the main car screen on that list (`apexnav://car/where` and `/loops`, handled only by the CarPlay
    scene).
- The real reason it didn't work (the owner: "it's not working for me"): `CPSupportsDashboardNavigationScene` and
  `CPSupportsInstrumentClusterNavigationScene` sat at the Info.plist's top level in project.yml. Apple reads them inside
  `UIApplicationSceneManifest`, so CarPlay never offered Vetta on the Dashboard or a car's cluster. They are moved, and a
  test pins where they go.
- The Dashboard shows the navigation app used most recently, so after a drive in Apple Maps it shows Apple Maps until a
  Vetta drive starts.
- Undo: remove `shortcutButtons` and the `openURLContexts` handler in `CarPlay/ApexCarPlay.swift`.

## 2026-11-01: Review 5, all 32 findings (U-106..U-137) built ("build all")

Five builders worked in parallel and Claude merged them. These are the calls, each with how to undo it.

- **Strip (A).**
  - Fixed strip height instead of the height animation, so the map's top edge stays still. The band is about 104–116 px
    even on the quiet line. Undo: the `.notes.notes-roadbook` height rule.
  - In landscape the third cell is dropped so the head fits in words. Undo: the landscape `.rb-box:nth-child(3)` rule.
  - A junction's road name wraps to two lines instead of ending in "…". Undo: `.rb-call b + span`.
  - Night strip is 112/124 px with line height 1.1. Undo: the two night rules.
  - The next cells print codes from `stripCode()`: R3, LHP, KEEP R, RBT 2.
- **Forecast (B, U-108).**
  - Pace is learned separately for corner sections (2+ corners within 500 m, padded 100 m) and open road. Undo:
    `sections: []`.
  - The factor stays within 0.85–1.25, and the arrival moves at most 1 min per minute driven. Undo: `RATE` in `eta.js`.
  - "About N min" is shown until 5 mi driven.
- **Coaching, end card, replay (B).**
  - U-111: one coaching sentence, from the Log's own writer. Undo: revert 2cdfdd4.
  - U-118: Share card is solid from the first frame and does nothing until the score lands.
  - U-128: the replay opens in follow view at the start and waits up to 4 s for tiles. Undo: `REPLAY_WAIT_MS = 0`.
- **Voices (C, U-113).** The owner chose to build the packs, not remove them.
  - Each voice has 9 asides and 4 sign-offs (`web/voice_lines.js` PACKS), and 42 new Kokoro clips were rendered. A test
    bans direction, "careful", "slow", distance and speed words from asides.
  - Asides play after the call, at most once per 45 s, never after a slow-down warning or in a chained run.
  - With plain words, the call is in the phone's voice and the aside in the pack voice; that was already so. Undo:
    strip `aside` in `packAside`.
  - Kit's asides avoid "slow". `themes.js` `voice.sample` is gone: the cards quote real lines.
- **CarPlay (D).**
  - Short instruction variants use the call's own words ("Very sharp left", not "Hairpin"). Undo: `cornerShort`.
  - U-120 is only partly fixed: CarPlay won't leave the trip strip empty, so it shows the distance driven, with time
    "--". Undo: `Measurement(value: -1…)`.
  - The guidance card's reserved share is 0.43 of the screen (was 0.36). Undo: `cardShare`.
- **Recording (D, REVIEW5 §7).**
  - The replay is driven by real elapsed time, not fewer photos. Undo: `dt = 0.01`.
  - Dynamic Type is its own ninth flow. Undo: `test09` and its matrix row.
  - Contrast is measured in Chromium. It found Roadbook day "MPH" at 4.22:1, under 4.5:1: left for the next review.
  - None of it has run on a Mac yet.
- **Garage and People (E).**
  - Crash check stays on with no contact: it still asks if you're OK and offers the emergency call. An always-visible
    line says what it does in each state. Undo: `crash: false` in the toggles.
  - "Earns 3×" is removed (nothing names what is tripled).
  - The Garage page shows you and your cars, Look and voice, Co-driver and The words. Ten settings rows sit behind one
    gear and open bottom sheets (`web/garage_settings.js`); every id is unchanged.
  - Every Log date now reads "Today, 8:02 AM" (`ApexFormat.dateTime`). Undo: revert `format.js`.
  - People's empty sides show a dimmed sample row captioned "Example", read as not real.
- **Not built:** REVIEW5's pushback to hide the live Score while driving. It reverses an owner decision, so it stays
  with the owner.

## 2026-11-01: Picks from the twostraws Swift skills list (and the iOS dev guide)

- github.com/twostraws/swift-agent-skills is a list of links, not skills. Most of what it links to is already covered by
  the packs below (concurrency, testing, App Intents, widgets, background work, App Store review, simulator,
  accessibility, UI copy). Added only the three that bring something new, all MIT with LICENSE kept:
  `ios-code-audit` (Chad Etzel, 34edb29: a read-only whole-codebase audit written to CODE_AUDIT.md),
  `swift-security-expert` (Ivan Magda, bda2e0c: Keychain, tokens, certificate trust, CryptoKit) and `swiftui-pro`
  (Paul Hudson, f2920b6: SwiftUI review, for the widgets, Live Activity and shell views).
- Skipped: Writing for Interfaces (Intent's /articulate covers it), the SwiftData, Core Data, focus-engine and Figma skills
  (Vetta doesn't use them), App Store Connect CLI (tools/crash_logs.py already does what we need), and second copies of
  concurrency and testing skills.
- github.com/keskinonur/claude-code-ios-dev-guide is a single README with no licence. Nothing to install; our CLAUDE.md
  and docs already do what it describes. Its XcodeBuildMCP tip needs a Mac, so it only helps a local session.
- Undo: delete those three folders.

## 2026-11-01: 18 of the Swift iOS skills installed in the repo

- You asked for github.com/dpearson2699/swift-ios-skills (upstream commit 8d90fd1). It has 86 skills. Each installed
  skill's description loads into every session and costs usage, so only the 18 that match frameworks Vetta imports are
  copied into `.claude/skills/`: carplay, mapkit, core-motion, activitykit, widgetkit, app-intents, swiftui-webkit,
  swiftui-uikit-interop, background-processing, push-notifications, authentication, cryptokit, swift-concurrency,
  swift-testing, app-store-review, ios-simulator, debugging-instruments, metrickit.
- Licence: PolyForm Perimeter 1.0.0. Using the skills to build our own app is allowed, closed-source included. The
  conditions: each skill folder keeps the LICENSE with its "Required Notice" copyright line, and the skills must not be
  repackaged and offered to others as a competing product. Vetta isn't one.
- Undo: delete those 18 folders. Add more: copy `skills/<name>` (with LICENSE) from a clone of the upstream repo.

## 2026-11-01: Intent design-strategy skills installed in the repo

- You asked for Intent (github.com/ghaida/intent). It's copied in the same way as Impeccable below: its 18 skills in
  `.claude/skills/` (intent, strategize, investigate, journey, organize, wireframe, articulate, blueprint, evaluate,
  fortify, include, measure, transpose, localize, philosopher, storytelling, specify, present; upstream commit 7111cb8,
  CC0) and its 6 agents in `.claude/agents/` (noor, ember, wren, vigil, rune, sage). Start with `/intent`.
- Its only hook prints a coloured banner when `/intent` runs, so it's left out.
- Undo: delete those 18 skill folders and 6 agent files.

## 2026-11-01: Impeccable design skill installed in the repo

- You asked for the Impeccable plugin (github.com/pbakaus/impeccable). `/plugin` doesn't work in cloud sessions, and
  the container is wiped after each one, so its Claude files are copied into the repo instead: the skill in
  `.claude/skills/impeccable` (v4.8.0, upstream commit 4f95649, Apache-2.0, with its LICENSE and NOTICE) and its four
  agents in `.claude/agents/impeccable-*.md`. Every session, cloud or local, now has `/impeccable critique|audit|polish…`.
- Its auto-hook is NOT installed. That hook runs a downloaded binary after every edit and at the end of every turn. The
  skill's launcher still downloads that binary (to `~/.impeccable/bin/`) the first time a command runs it.
- Undo: delete `.claude/skills/impeccable` and `.claude/agents/impeccable-*.md`. Update: copy the same folders from a
  newer clone of the upstream repo.

## 2026-10-31: TestFlight notes 09, 10 and "make video doesn't work"

- 09, stages on the map: New stage from a drive no longer shows the speed/elevation strip. It shows the drive as a small
  north-up map with the stage drawn bold and circled (web/route_thumb.js), the drive's roads as keys ("Bank Road uphill ·
  0.6 mi"), and Start and Finish sliders for any other stretch. A road key covers it from where you joined it to where
  you left it; a crossing or a short unnamed link (under 60 m) doesn't split it; "uphill"/"downhill" at 15 m or more of
  height change; under 200 m isn't offered. Undo: the segRoads/segMap/segFrom block in web/analysis.html.
- The roads come from map matching the drive on the public Valhalla server (contributor.js matchDrive now also asks for
  edge names), first and last km never sent, as privacy.html already says; asked when the marker opens on a drive and
  kept on the phone (apex.driveRoads, 30 drives) so a drive's track is sent once. Roads in the first or last km stay
  unnamed (use the sliders). Undo: drop 'edge.names' and road_runs.js.
- 10: "Which route was better?", each choice a key with a small map of that drive's route (start filled, finish open).
  The ranking underneath still ranks by drive name, as before.
- Make the video: on iOS the dashcam video sat display:none and was never played, so WebKit never loaded its data,
  'loadeddata' never fired and Make the video stayed greyed. The video now stays in the page (1 px, see-through),
  preloads, and a muted play/pause decodes the first frame. The flyover's recording canvas is now put in the page too
  (WebKit streams a canvas as it renders it). Both keys are hidden where the browser has no MediaRecorder type or no
  canvas captureStream, and a failed or empty recording says so instead of handing over nothing. Not verified on a
  phone (Chromium only here). Undo: web/dashcam.js, web/flyover_video.js.
## 2026-10-31: TestFlight notes 05 and 06 (Crew drives row gone; the Score board as totals)

- *No Crew drives row; the crew page's drive section is "Upcoming drives"*: every planned drive of that crew as its card,
  a + in the head's corner opens the plan form in place (it gives way while the form is open), the last drive remembered
  above for three days, Meets near you at its foot. Someone with crews but no crew page (the page failed to load) still
  gets the old section. Undo: `drives` in the crewPage mount (web/cockpit.js) and the `!inCrew` on `drives`.
- *The board ranks the total of drive Scores*, Week / Month (default) / Year / All time, the pick kept on the phone, each
  row a face, the rank, @handle, car, "N drives" and the total; "--" for members who share none. Weeks start Monday, all
  periods in UTC days (as the old board's month). Undo: `board()` in web/crew_page.js back to `c.board`.
- *Drive Scores had to reach the server* (only stage bests did): migration 0043 `drive_scores`, one row per drive per crew
  the driver shares Scores with, written when you publish (as board_entries), so switching a crew on later doesn't
  expose drives sent before it was on, except: *past drives in your Log go up too* the first time the board opens (the
  stage board already publishes past runs). The toast now says "sees your drive Scores now", not "from your next drive".
  A drive goes up 5 s after any Log refresh when signed in, and before the board loads. Only the number and the day.
- *A drive deleted from the Log keeps its Score on the board* (the server has no delete for one drive yet). Undo/extend:
  a `DELETE /api/drives/scores/:id` called from the Log's delete.
- *Old builds keep the page's `board`* (best stage Score this month) unchanged; only new builds call the new route.
## 2026-10-31: TestFlight feedback 01-04, 07, 08 (one surface, the island, centred fields, bottom sheets, the share sheet)

- 01: a route Preview now hides the route card, Where to? and the tabs like a replay does (one class, `replaying`, for
  both); Done or the plate's × brings the card back. Undo: `state.mode === 'replay'` in paintIdle (web/cockpit.js).
- 02: with the keyboard up, Where to? stops 12 px below the Dynamic Island (safe area, at least 20 px) instead of running
  the full height. Undo: `html.kb-open .plan.open { height: 100%; }` in web/index.html.
- 03: read as "vertically centred, left-aligned": every written field (textarea.field) has the one-line field's padding so
  its words sit in the middle, starts at its rows and grows as you write; crew chat starts one line tall. Undo: the
  `textarea.field` rule in web/index.html and the input listener in cockpit.js.
- 04: menus (every `.side-pop`: crew drives, crew settings, friends, a friend's profile, About this road) slide up from
  the bottom over a dim scrim; nothing behind is tappable; a tap outside slides it away at once (through its own Done/Close,
  so what that does still happens), not a shake first. Pop-up cards (`.overlay.dim`) slide up too; they already closed on
  an outside tap. A desk (1100 px+) keeps them beside its panel. Undo: the feedback-04 rules in web/index.html.
- 07: every invite and share link goes through `ApexSaveFile.shareLink`: the shell's real share sheet in the app (new
  `shareText` bridge, UIActivityViewController), the web's share sheet, else the clipboard with a toast; the "Copy this
  link" box is gone. In the app the drive card image goes to the shell's share sheet too. Undo: copyText in cockpit.js.
- 08: the crew page's Share (an image card, Factory livery) is removed; Invite is how a crew is shared.

## 2026-10-31: "it always thinks my phone is warm"

- The battery saver came on at iOS's "serious" thermal state, where a phone charging on a dash with GPS and CarPlay sits
  much of the time. You then: only at the highest level. Now on at critical only, off below it. Undo: THERMAL_ON = 2 in
  web/power.js.

## 2026-10-31: the crash on open, found and fixed (nothing reverted)

- TestFlight's crash report (tools/crash_logs.py, new on-demand workflow): CarPlay/ApexCarMap.swift set the hillshade's
  shadow colour as one UIColor; MapLibre Native 6.x takes an array (multidirectional hillshade), threw
  doesNotRecognizeSelector the moment the car map's style loaded, and took the whole app down. Shadow and highlight are
  now arrays; a test holds it. Nothing else was changed or reverted.
- Next time: the carplay-shots workflow opens the car's screen in the simulator; it runs before a native car change merges.

## 2026-10-30 (night): the simulator smoke test starts past the welcome

- main's simulator test had failed since 05:51 (the welcome moved into the app, U-65, and its Start brings up the
  location sheet; the test still looked for "Get started" and a Crew tab), and a failed simulator test holds back
  TestFlight. The test now launches with the review flags past the welcome and answers the location sheet, and looks
  for People. Undo: the launchEnvironment lines in UITests/CockpitSmokeTests.swift.

## 2026-10-30 (evening): the People review and the speed review, built (your go: open sign-up, two tabs, the speed pushback)

Your calls, built: Vetta is open (anyone who signs in is a member; invite links only add a friend or join a crew); People
is two underlined tabs; dead reckoning on the car's arrow, contours off above 8 m/s, the map at 2x pixels in a drive.
My calls (undo in brackets):
- A crew link friends its sender on a first join, never across a block; reports from an uninvited account count to the
  3-report auto-hide only after a week; Who can invite: Owner voids members' links (`befriendOnLink`, `reports_sql.ts`,
  `crewInvitesBy`). **For you:** a crew link posted publicly makes strangers the sender's friends (they then see the
  sender on the map if the sender shares with friends); limit it to private crews if you'd rather.
- Who came to a drive is new stored data (a handle, 7 days, in Download my data); privacy page updated (migration 0041).
  Both migrations (0041, 0042) are applied to production and preview, additive only.
- Invite to a drive starts a convoy (planned drives take no guests yet); "Convoy now" sits on a chevron beside Start.
- The crew page's Invite is the one invite key; the gear keeps who can invite and Leave.
- MapLibre Native 6.31.0 for the car's map (7.0 is two days old); the web car map is the fallback if the native style
  fails. Its bundled components need a licence check before release (**for you**).
- The map is a fixed stage with camera padding; contours back after 3 s stopped; minor labels hidden at speed.
- End shows its card at once and scores in the worker ("…" while pending); the Log reads summaries (IndexedDB v3,
  lossless upgrade); the Log frame loads at idle; Try a theme no longer starts the demo.
- The launch loads only the cockpit; People, Garage, crews and convoy load on first use or when the map goes idle;
  fonts are bundled (no Google request; privacy page's Google Fonts line removed, **for you to glance at**).

## 2026-10-30: the CarPlay guidance card sits at the top (you saw it float mid-left)

- In guidance the map's top bar (with End) now hides itself after a moment, as Apple Maps' does; the card had been
  held below a bar that never hid. A tap on the map brings End back; the map buttons stay. Idle keeps the bar up.
  Not checked on a car (the simulator can't show it reliably). Undo: `automaticallyHidesNavigationBar = false` in
  `startGuidance`.

## 2026-10-30: Billet's primary keys were unreadable (REVIEW_PEOPLE.md P-01, fixed straight away)

- Under Billet every solid key (Sign in with Google, Invite, Accept, Join crew, Start a convoy, Plan it, and every
  "on" key app-wide) was dark ink on dark metal: the Billet metal rule out-ranked `.ink-btn.solid`. Solid and on keys
  are now light machined metal with dark ink. A plain bug, so built before the rest of the review. Undo: the P-01 line
  in web/index.html. The other 34 People findings wait for you (some are overhauls).

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
