# Vetta: fifth review. The whole frontend, with instruments

Reviewer: the same critic and automotive HMI hand, with the code open (read only, main at 2a9c15d).
Evidence: the fifth review recording of 2026-11-01 (`scratchpad/r5`: eight flows, 562 phone photos, 278 car photos,
ten videos, eight transcripts, the app's own logs). Paths below are relative to the pack; `billet/phone.mp4 @ 06:28` is
a frame I pulled from that video (the transcript's "@" column is the same clock). Where I read the code to name a cause
I say so.

The instruments. This review was made with the design skills now in `.claude/skills/`, used as lenses over the same
evidence: impeccable's critique and audit methods (its launcher downloads a binary, so I did not run it; I read
`reference/critique.md`, `audit.md`, `audit.native.md`, `craft-floor.md` and `ios.md` directly and applied them by hand),
Intent's evaluate (the ten heuristics and the anti-pattern catalogue), fortify (the state inventory), include (WCAG 2.2,
VoiceOver, Dynamic Type, targets, reduced motion), articulate (every word and every call), and the Apple skills for the
car, the island and App Review. Each finding names the lens that found it. Where a lens was wrong for Vetta, §5 says so.

Two things to know before the critique. First, the guided drive replayed at about a third of real speed while its dial
read 70 (0.83 mi in the 129 s between "replay driving" and "Tight right"; Billet covered the same 0.86 mi in 44 s), so
its 257 steps ran out at 3.6 of 23 miles and never reached End, and its forecast and time leads cannot be judged; I judged
timing from Billet and Tapedeck, which ran true. Second, almost everything Review 4 asked for is on screen and works: the
welcome, the car in every drive, the quiet line that names the road, the end card that agrees with the Log, the fitted
trail, the island's codes, the Done key, feet instead of metres, "careful" once a run. That is the floor this review stands
on, and it is a high one.

---

## 1. The critique

### The premise, first

Vetta's promise is a co-driver. Watched for a fifth time, the co-driver is now real: it reads the road ahead, calls
"Tight right, careful" 850 feet out at 67 mph, goes quiet on the straight and says so, comes back for the junction, and
signs off with a score. That part of the app has crossed from furniture to instrument. The question this review has to ask
is the one the standing note asks: is the rest of the app the same object, or several objects in one bundle, and where is
it pretending?

My answer, having looked at every screen: Vetta is three things wearing one typeface. The first is the cockpit (idle
map, plan sheet, route card, drive screen, end card, Log page), which is designed, in the full sense, and in places the
best of its kind. The second is the Garage, which is a settings website in Roadbook's clothes: twelve sections on one
scroll, a scrollbar showing at the right edge (`signed-in/phone/013-account-1.png`, `016-account-4.png`), a paragraph that
counts zeros ("0 drives (0.0 mi), 0 spots, 0 privacy zones, 0 recent places", `015-account-3.png`), a switch that is on
with nothing behind it (Crash check on, Contact name and Phone number empty, `014-account-2.png`), and a line that tells a
signed-in member standing in the Garage to "Sign in and turn on Share road feel in the Garage" (`013-account-1.png`).
REVIEW3's first roadmap item (the Garage's settings behind rows) is still the right answer and still not built. The third
is People, which is two tabs that each hold one sentence and one key above eighty percent of empty ink
(`signed-in/phone/001` to `011`), true to the account (it has nobody) but telling a new member nothing about what a friend
on this map looks like, what a crew page is, or why they would want either.

And where is it pretending? In three places, and I want to be exact, because each is a place the app says more than it
knows or more than it does.

One: the themes' voices. REVIEW.md's promise, which the owner approved and the theme picker still advertises, is that the
character lives in the voice: Marguerite "Left four, tightens. Long. Care.", Kit "Easy in, late out", Hale "Left four.
Tightens. Long." (`signed-in/phone/017`, `018`, with Hear keys). On tape the three drives say the same twelve lines word
for word (`billet/transcript.txt`, `tapedeck-night/transcript.txt`, `guided-drive/transcript.txt`); only the sign-off
differs, and that one line is the best proof of how much a character is worth. Tapedeck then draws a fox and a label,
"KIT SAYS", over a field that reads "--" for the whole interstate and most of the corners (`tapedeck-night/phone/003` to
`060`, `095`), and when it does fill, it repeats the strip's own words (`080`). A labelled empty box, in the theme that is
supposed to be the fun one, is the app admitting the character is not there yet. Either Kit speaks, or Kit goes.

Two: the forecast. The route card says 33 min for 23.2 mi (`billet/phone/002`). Over the next 4.2 miles the status line
says 32, 31, 27, 22, 21 (`billet/phone.mp4 @ 03:25`, `@ 04:25`, `@ 05:15`, `@ 06:28`, `@ 06:41`), and the arrival walks
backwards from 8:36 to 8:28. The drive then took 6:19 for those 4.2 miles, which is exactly the pace the card forecast; it
was the learner that was wrong, scaling nineteen miles of Dry Ridge by the pace of an interstate join. Tapedeck does the
same (33 to 20). The guided drive, slowed by the rig, went the other way, 33 to 57 (`guided-drive/phone/020` to `035`),
and the car's arrival jumped from 8:38 to 9:04 in a mile (`guided-drive/car/020`, `035`). Review 4 fixed the forecast's
mean; the number still will not sit still, and a number that moves twelve minutes in three miles teaches the same lesson
the sight plate once did.

Three: the strip's second cell. In nearly every driving photo in every flow the next call is cut: "VERY …", "EASY …",
"MEDIU…", "OPEN …", "SHAR…" (`guided-drive/phone/009`, `050`; `tabs/phone/005`, `024`; `billet/phone/004`, `060`;
`tapedeck-night/phone/009`), and on the welcome, the one place the app shows off its strip, "RIG…" and "CR…"
(`first-run/phone/001`, `003`). The cell is `nowrap; text-overflow: ellipsis` by design (`web/index.html:174`, read in
code). A road book never prints half a word. The head is now whole, which Review 4 asked for, at the price of a head that
wraps to three lines and a strip whose height jumps seventy pixels between calls (`guided-drive/phone/050` against `100`).
The grammar of the strip needs deciding once: words in the head, codes everywhere else.

### Opening it at the kerb

The first frame is the welcome now (`first-run/phone/001-opening.png`): the mark, VETTA, "Your co-driver for the long way
home.", the strip cycling LEFT 2, LEFT 4 TIGHTENS, RIGHT 3, the red Start, "Watch a replay". It is calm and it is
Vetta's. Start brings the location sheet over the idle map with a reason on it (`004`), and then the idle map, which is
still the best screen in the app and unchanged where it should be (`005`): the place plate, the Layers key, one field, the
record key now with a chevron for the convoy, "Loop from here · 45 mi · On the twistiest roads nearby", four tabs. Layers
(`006`) is right: five switches that read on and off, "Who sees me", and the Notes detent that Review 4 asked for. Two
things on the welcome: "RIGHT 3" wraps onto two lines where "LEFT 2" fits, and the next-call cell cuts its word; the demo
strip has the same disease as the real one.

### Planning a Sunday

Type "Winton Woods" and the rows come back whole (`planning/phone/002`). Tap one and the card rises open, as Review 4 asked
(`003`): "To Winton Woods Middle School", 9.0 mi, 23 min with "+7 MIN FOR FUN" under it, 34 corners, the profile with a tick
per corner, three facts with glyphs, four half-dials (Twist 56, Flow 23, Surface --, Cameras --), "Road feel after first
drive", two alternative tiles ("Fun 45 · 23 min · this one", "Fun 37 · 16 min · 7 min quicker"), the Roads detent, Drive
it and Preview, and the links below (`005` to `007`). This is the instrument REVIEW.md drew and it reads as one. Two
faults. Collapse it and the bar still cuts the name, "To Winton Woods Middle S…" (`008`), although Review 4's fix for this
exists in the stylesheet (`.route-bar.two`, `web/index.html:249`) and was not applied; and when the card collapses the
camera recentres on the car and the route leaves the screen entirely: `008` shows Jason Drive and Lincolnshire Road with
no red line on it. The driver who just chose a route is shown a map without one.

The GPX route's card is thinner than the searched route's (`guided-drive/phone/001`): "23.2 mi · 33 min · 30 corners",
the profile, "1 café" with a glyph that reads as a mountain, and four dials all "--", including Twist and Flow, which the
card can compute from the geometry it is drawing the profile from. Thirty corners and "Twist --" on the same card is the
app contradicting itself.

### Starting, and the strip

Drive it. The sheet closes, the tabs leave, and the drive screen is up in one cut (`billet/phone/002`,
`guided-drive/phone/002`): "Clear · Quiet · Northwest Expressway · next corner 0.8 mi", the map with one CAFÉ and one FUEL
stamp, the status line with Rec, the time left and the arrival on two lines, Report and End, the binnacle. The binnacle is
still the best thing Vetta has made. In Billet, with the red numerals on black and the needle's glow, it is the one place
the theme is more than a palette; it looks like a thing you could buy. One cut: a long road name starts under the dial, so
Billet reads "oad: Northwest Expressway" for the whole motorway (`billet/phone/002` to `004`), and the binnacle contract
says nothing on it is cut.

Then the first call: "0.4 MI · TIGHT RIGHT · CAREFUL | 1.0 MI · VERY …" (`billet/phone/004`). The tulip is right, the head
is whole, the modifier is red and one size down, the next cell is cut. Then the hairpin: "VERY / SHARP / LEFT" on three
lines with "ALMOST BACK ON ITSELF · LONG · CAREFUL" under it (`billet/phone/009`), whole at last, and a strip two lines
taller than it was a second ago; the map, the arrow and the sight plate all step down to make room and step back up when
the call clears. On a screen a driver reads in glances, the one thing that must not move is where things are.

The sight plate is steadier than it was: OPEN, then 55, then OPEN, holding for several photos at a time (`billet/phone/009`
to `060`); the 5 mph steps and the hold did their work. The two reds are still there (the Sight cell is red at 0 mph with
"30" in it while the plate under the arrow has hidden itself, `billet/phone.mp4 @ 07:47`), and I say so again at the end.

### Being told the road

Here is the voice, timed from the two flows that ran true. Billet: "Tight right, careful" 850 ft at 67 mph (8.6 s); "Very
sharp left, almost back on itself, long" 400 ft at 34 (8 s); "Easy left, then 400 feet" 300 ft at 47 (4.3 s); "Easy right"
200 ft at 37 (3.7 s); "Medium right" 250 ft at 36 (4.7 s); "Open left" 350 ft at 49 (4.9 s); "Sharp left, like a
junction, careful" 600 ft at 45 (9 s). Tapedeck within a second of each. Nothing lands inside a corner now; the easy
corners get four seconds, which is enough for an easy corner; the tight ones get eight or nine, which is a real co-driver's
margin. The passed corner moves on while the car stands in it: at 0 mph the strip reads MEDIUM RIGHT at 0 ft, three
seconds later OPEN LEFT (`billet/phone.mp4 @ 07:47`, `@ 07:50`), so Review 4's one "can't tell" is told. "Careful" is said
twice in nine minutes, on the two corners that earn it. And the three sign-offs ("Complete. Score, five hundred
fifty-five." / "Five hundred sixty-one. That's a wrap." / "That's the drive. Score seven hundred eighty-eight.") are the
three characters in one line each.

One sentence is wrong, and it is said in every flow: "Easy left, then 400 feet" (`billet/transcript.txt` 08:07:31,
`tapedeck-night/transcript.txt` 08:19:54, `tabs/transcript.txt` 08:02:58). Then four hundred feet what? The next corner
is said thirteen seconds later, on its own. The chain link speaks its distance and swallows its object: `plainLink`
returns "then ${distance}" and the next call is not in the sentence (`web/plain_notes.js:29` to `:45`, read in code). A
rally co-driver says "easy left into easy right, one hundred"; a plain one says "easy left, then easy right in four hundred
feet"; either is a sentence. This is not.

### The car

The car is in the drive from the first second to the last, as Review 4 asked: the trip preview with the arrival on it
(`guided-drive/car/001`), the guidance card with a tulip and "0.9 mi · Tight right, careful" (`002`), the continue step
"Follow New Haven Road · 1.3 mi" with a straight arrow (`081`), the record card for a free drive ("Recording · 0.1 mi
driven", `free-drive/car/007`), Drive on the idle bars (`free-drive/car/001`), idle again after End (`020`). Structurally
this is what Apple asks for and more than most third-party navigation apps manage.

Three things a driver would notice. The hairpin's card carries four lines, "Very sharp left, almost back on itself,
long, careful", at the card's full type size for half a mile (`guided-drive/car/035`, `050` to `070`). CarPlay gives the
card instruction variants so the system can pick the one that fits; the app sends the long instruction and the street name
as the two variants (`CarPlay/ApexCarPlay.swift:518`, read in code), so the short form a glance needs ("Hairpin left ·
long") does not exist. The sight plate under the arrow prints OPEN at the size of a road sign for the whole of a drive on
which nothing is restricting the view (`free-drive/car/007` to `019`, `guided-drive/car/002` to `012`); on an 800-pixel
panel it out-shouts the guidance card, and OPEN means there is nothing to say. And the free drive's trip strip reads "--
arrival · -- min · -- mi" for five minutes (`free-drive/car/002` to `019`): honest, as Review 4 asked, and dead; three
dashes in a row is a strip that should not be there.

### Report, the island, the phone on its side

The report sheet is unchanged and still the best drive interaction in the app: six orange plates, one line, Cancel, and
the key becomes "Undo Gravel" (`guided-drive/phone/074`, `075`). The island reads "0.4 MI" and "R3" in compact
(`guided-drive/phone/209`), and expanded "0.4 MI · Medium right · Dry Ridge Rd · 49 min left" (`210`): Flighty's standard,
met. One cut remains: when the notes are quiet the compact trailing reads "QUIE" with the T under the sensor
(`guided-drive/phone.mp4 @ 32:12`); the code scales the word to 0.6 and the island still clips it
(`LiveActivity/ApexLiveWidget.swift:91`).

On its side, the cockpit is broken, and this is the one thing in the recording I would not let a driver see. The strip in
landscape shows "0.3 MI", a tulip, "0.7 MI", a tulip, "1.1 MI", a tulip, and no words at all: the head "MEDIUM RIGHT" is
clipped to a sliver and the next calls to "(" and "S" (`guided-drive/phone/213-landscape.png` to `218`, portrait at the
same moment `212`: "0.3 MI · MEDIUM RIGHT"). In the right column the Road line prints across the Score ("Road: New
Biddinger Road577"), the Sight cell's label is cut, the dial is a third of its portrait size, and the lower half of the
column is empty. Landscape is how a phone sits in most mounts. The call, the one thing the screen is for, is missing from
it.

### Ending, and the Log

End. The card is now a moment: the whole drive as a red line on the dark map, DRIVE SAVED, "Dry Ridge Rd · 4.2 mi · 6 min
· 7 corners", 555 /1000 big, one sentence, Share card solid, Mark a stage, Open in the Log, Done (`billet/phone/103`,
`tabs/phone/014`), and the Log says the same number (`billet/phone/104`: 555; `tabs/phone/015`: 788). Watch it arrive,
though: for a second the score is three dots and the solid key is "Open in the Log" (`billet/phone.mp4 @ 09:06`); then the
score lands and the solid key becomes "Share card". The primary action swaps under the finger that is reaching for it.
And the one sentence on the card is not the one sentence in the Log: the tabs drive's card says "Next time, smooth: build
cornering load gently" and its Log page says "Braking finished by the middle of each corner, and nothing stands out to
fix" (`tabs/phone/014` against `015`); Billet's card says "rhythm: commit evenly" and its Log says "in 2 corners you rolled
with neither brake nor gas" (`billet/phone/103` against `104`). Two engines write the product's best sentence and they
disagree about the same drive. In Billet the idle map's place plate, "Harrison Township · Dry · 54°", is drawn over the end
card's map (`billet/phone/103`); in Roadbook it is not (`tabs/phone/014`); and after a free drive ends, the idle map has
no plate at all (`free-drive/phone/021`).

The Log page is the page I would show someone (`tabs/phone/015` to `019`): the name, the date, the score with its four
honest bars, the sentence, Replay solid, the traces with the pencil cursor and the six-cell readout. Two words in it are
from another book: the readout names the corner "Left 5 minus" while the strip the driver just read said "Easy left", and
the date is set as a database would set it, "2026-11-01 8:02 AM".

### The replay

Replay has its Done key now (`tabs/phone/020`). It also has a state nobody designed: when the drive's two minutes run out,
the Play switch goes off, the dial stays at 46, the Sight cell stays red, the strip says "Clear · Carolina Trace Road · Full
notes", and nothing says the replay has finished (`tabs/phone/031` to `038`; the map drifting miles away in those frames is
the test's own swipes, which fell on the map because the tab bar was hidden). Finished and paused look identical. In
Billet the replay opens on a black void with an arrow in it for a frame while the tiles load (`billet/phone/106`).

### The themes

Same information, each in its own character: that holds, and better than in Review 4. Tapedeck's VFD teal and amber, the
seven-segment speed, the bar meters under SURFACE and BRAKE / TURN that move when the car does (`tapedeck-night/phone/060`
against `003`), the quiet line abbreviated to fit the dot font ("NORTHWEST EXPY · CORNER 0.8 MI"), the orange End key.
Billet's black faces and red glow. Nothing is missing in one that works in another, which is the contract. What is thin
is the part REVIEW.md said would carry the fun: Kit is a 40-pixel fox beside an empty field (above), the voices are one
voice, and Tapedeck prints the limit twice ("LIMIT 70" under the speed and the Speed Limit sign beside it,
`tapedeck-night/phone/003`). The theme picker's cards (`signed-in/phone/017`, `018`) still promise more character than the
drives deliver; the cards are the one place the pretence is written down.

---

## 2. Verdict

Against the best of its kind: the cockpit (idle map, plan sheet, route card, binnacle, report sheet, end card, Log page)
is drawn and now behaves at the level of Halide and Flighty, and the co-driver, timed from the two true-speed flows, reads
the road the way a good human co-driver reads it, with the margin, the silences and the sign-off; nothing in Apple Maps,
Google Maps or Waze does what the strip and the voice do together on Dry Ridge Road. The car screen is structurally what
Apple asks for and better looking than most. But Vetta is still three objects in one bundle: a cockpit that is an
instrument, a Garage that is a settings website, and a People tab that is a sentence on a void; and in three places it
says more than it has: the themes advertise voices that are one voice, the forecast moves twelve minutes in three miles,
and the strip prints half-words in its second cell on every drive. The three things between it and greatness: the strip's
grammar settled once (words in the head, codes elsewhere, a fixed height, and a landscape layout that has words at all:
U-106, U-107, U-133); numbers and sentences that agree with themselves (the forecast held still, one coaching sentence,
one vocabulary from strip to Log, a card whose keys do not swap: U-108, U-111, U-118, U-123); and character that is
actually on tape, which means either the three voice packs REVIEW.md specified or the honest removal of Kit's box and the
cards' quoted lines until they exist (U-113). The overhauls I would do, in order: the strip grammar; the voice packs; the
Garage as a Garage (cars, look, co-driver, one gear) rather than a scroll of sections; and the forecast shown as what it is
(a band, "about 30 min", that narrows as the drive teaches it) rather than a minute that lies in both directions.

---

## 3. Findings

Numbered on from U-105. Severity: P0 broken or unsafe in a drive; P1 wrong or confusing on a main path; P2 worth
fixing; P3 polish. Lens: which instrument found it (own eye, impeccable, evaluate, fortify, include, articulate, carplay,
app-store-review, activitykit).

| ID | Severity | Lens | Flow / step (evidence) | What's wrong | The fix (files) | How the next recording shows it |
|---|---|---|---|---|---|---|
| U-106 | P0 | own eye, impeccable (adapt) | guided-drive `phone/213-landscape.png` to `218` (strip: "0.3 MI", tulip, "0.7 MI", tulip, "1.1 MI", tulip, a sliver of a letter and "(", "S"; right column: "Road: New Biddinger Road" printed across "577", the Sight label cut, the dial a third of its size, the lower half empty) against `212-back-in-app.png` (portrait at the same moment: "0.3 MI · MEDIUM RIGHT") | In landscape the strip has no words: the head and both next calls are clipped to nothing, so the drive screen shows distances and tulips only; the instruments column overprints the road name on the Score. | Landscape block in `web/index.html` (the `orientation: landscape` rules near `:857`): the strip over the map column shows distance, tulip and the head word at 21 px on one line (the next cell is dropped or becomes the code alone); the right column lays out as two rows (dial and Limit/Sight; g-ball and Score) with the Road line on its own row below and `min-width: 0` on every cell; nothing may overlap (the theme contract test should assert no two binnacle boxes intersect in landscape). | `213` reads "0.3 MI · MEDIUM RIGHT"; the Score and the Road line are on separate lines. |
| U-107 | P1 | own eye, impeccable (craft floor: real copy at every width), articulate | guided-drive `phone/009` ("VERY …"), `050` ("EASY …"); tabs `phone/005` ("OPEN …"), `023` ("OPE…"), `024` ("MEDIU…"); billet `phone/004` ("VERY …"), `060` ("MEDIU…"), `095` ("SHAR…"); tapedeck-night `phone/009` ("EAS…"); first-run `phone/001` ("RIG…"), `003` ("CR…"; and "RIGHT / 3" wrapped where "LEFT 2" fits) | The next-call cell is `white-space: nowrap; text-overflow: ellipsis` (`web/index.html:174`) and about six characters wide, so the next call is a cut word in nearly every driving photo and on the welcome. | `web/instruments.js` `renderNotes` and `web/index.html:174`: the next cell prints the note's code (`R3`, `L5`, `HPL`, `CREST`) under its distance beside the tulip, never words; the head keeps the words. The welcome's `OB_NOTES` loop (`web/cockpit.js:6117`) gets the same renderer, so nothing on it wraps or cuts. | No ellipsis in any strip photo; the welcome's three calls whole. |
| U-108 | P1 | own eye, fortify | billet `phone/002` ("33 min left · 8:36 AM" at 0.15 mi), `phone.mp4 @ 03:25` (32), `@ 04:25` (31), `@ 05:15` (27 · 8:33), `@ 06:28` (22 · 8:29), `@ 06:41` (21 · 8:28), `phone/103` (the drive: 4.2 mi in 6 min, exactly the card's pace); tapedeck-night `phone/003` to `095` (33 → 20); guided-drive `phone/020` (32), `035` (57), `car/020` ("8:38 arrival"), `car/035` ("9:04 arrival") | The pace learner (`web/eta.js` `factor`, `SMOOTH`) scales all the time left by the pace of the part driven, so an interstate join pulls nineteen miles of Dry Ridge down to 21 min and the arrival walks back eight minutes in three miles; the card's 33 min was right. (The guided flow's swing the other way is the rig's slow replay, but it shows the same learner over-reaching.) | `web/eta.js`: bound the factor to 0.85–1.25; learn it per section class (open road, corner section) so a fast join does not reprice the twisties; slow `SMOOTH` so the arrival moves at most one minute per minute driven; round the status line to five minutes while under five miles of evidence ("about 30 min"). | On Billet the status line stays within 3 min of the card's number through the first five miles; the arrival never moves backwards by more than a minute between photos. |
| U-109 | P1 | articulate | billet `transcript.txt` 08:07:31 ("Easy left, then 400 feet"), 08:07:44 ("Easy right" 13 s later); tapedeck-night 08:19:54; tabs 08:02:58 ("Easy left, then 500 feet") | The chained call speaks its link and its distance and leaves out the corner it links to: `plainLink` returns "then ${distance}" and `plainChain` appends it after the last note with nothing following (`web/plain_notes.js:29`, `:45`). The sentence has no object. | `web/plain_notes.js` `plainChain`: when the chain's last link has a next note within the chain distance, say it: "Easy left, then easy right in 400 feet"; when it does not, drop the link ("Easy left."). The rally chain's bare number (owner's call) is a complete rally sentence and stays. | Every "then" in the transcripts is followed by a corner. |
| U-110 | P1 | fortify (state inventory: success) | tabs `phone/031` to `038` (Play off, dial frozen at 46, Sight "Open" red, strip "Clear · Carolina Trace Road · Full notes", scrubber at the end; the map drift is the test's swipes) | A finished replay is indistinguishable from a paused one: nothing says it ended, the instruments hold their last values, and the quiet line reads the mode's name. `cockpit.js:1592` stops only the video when playing ends. | `web/cockpit.js` replay tick: on the last sample set a finished state: the plate reads "Replay finished · 788", the strip "That's the drive", the dial to 0, Sight to "--", Play shows a Replay-again glyph, Done solid. | `031` shows the finished plate and a zeroed dial. |
| U-111 | P1 | articulate, evaluate (consistency) | tabs `phone/014-drive-ended.png` ("Next time, smooth: build cornering load gently: squeeze the wheel in, don't snap it.") against `015-in-the-log.png` ("Braking finished by the middle of each corner, and nothing stands out to fix."); billet `phone/103` ("Next time, rhythm: commit evenly…") against `104` ("…in 2 corners you rolled with neither brake nor gas…") | The end card and the Log write different coaching sentences for the same drive, from different inputs; the tabs pair contradict each other outright. The card's sentence also carries two colons. | One writer: the Log's `coach` sentence (the one with the evidence behind it) is the card's sentence, computed in the same `save` job that scores the drive (`analysis_worker.js`), and the card shows it when the score lands; drop the "Next time, X:" prefix and the second colon. | `014` and `015` carry the same sentence. |
| U-112 | P1 | carplay | guided-drive `car/035-driving.png`, `050`, `063` to `070` ("Very sharp left, almost back on itself, long, careful" on four lines at card size for half a mile) | The guidance card carries the phone's full plain-words call; `instructionVariants` are the long instruction and the street name (`CarPlay/ApexCarPlay.swift:518`), so CarPlay has no short form to fit. A glance cannot read four lines. | `ApexCarPlay.swift` `guideChanged`: variants in decreasing length, all the same instruction: ["Very sharp left, almost back on itself, long, careful", "Hairpin left, long, careful", "Hairpin left"]; the phone's `guideMessage` (`web/carplay.js`) supplies `short` beside `instruction`. | `035` shows at most two lines on the card. |
| U-113 | P1 | own eye (the fake), articulate | tapedeck-night `phone/003` to `060`, `095` ("KIT SAYS --" for most of the drive), `080` (Kit repeats the strip's "MEDIUM RIGHT"); `billet/transcript.txt`, `tapedeck-night/transcript.txt`, `guided-drive/transcript.txt` (identical corner lines in all three voices); signed-in `phone/017`, `018` (the cards quote "Easy in, late out" and "Left four. Tightens. Long." with Hear keys) | The themes promise three characters in the voice and deliver one voice with three sign-offs; Tapedeck draws a labelled empty field for its character. This is the one place the app advertises what it does not have. | Either: the voice packs of REVIEW.md 4.4 (Kit's and Hale's own modifiers and asides, recorded: owner's item) and Kit's box filled with Kit's aside at the pre-call, cleared when the strip's head changes; or, until then, remove the KIT SAYS row (`web/instruments.js` Tapedeck renderer) and the quoted lines on the cards (`renderThemePicker`), keeping the voice name and the sign-off. | Tapedeck's drive has no empty labelled field; the three transcripts differ in more than the last line, or the cards no longer quote lines that are not said. |
| U-114 | P2 | own eye | planning `phone/008-route-bar.png` ("To Winton Woods Middle S… · 9.0 mi · 23 min · 34 corners") | The collapsed bar still cuts the name: Review 4's `.route-bar.two` (`web/index.html:249`) is in the stylesheet and not applied here (`cockpit.js:2074` sets the name; the class is not set for this name). | `web/cockpit.js:2074`: after setting the name, add `two` when `b.scrollWidth > b.clientWidth` (or always for names over 18 characters). | `008` shows "To Winton Woods Middle School" whole. |
| U-115 | P2 | fortify (partial state), own eye | guided-drive `phone/001-route-from-gpx.png` ("30 corners", the profile with its ticks, and Twist "--", Flow "--") | A GPX or loop route's card knows its corners and draws its profile but shows Twist and Flow as unknown; those two are geometry, the same geometry the searched route's 56 and 23 come from. | `web/route_card.js` dials: compute Twist and Flow from the track's own events and curvature for any track with geometry; keep "--" only for Surface and Cameras until measured or fetched. | `001` shows numbers on Twist and Flow. |
| U-116 | P2 | articulate, fortify | signed-in `phone/013-account-1.png` ("Road data · Off. Sign in and turn on Share road feel in the Garage to share." while signed in, in the Garage, with the switch three sections above) | The line is for the signed-out state (`cockpit.js:5110`, `ambient.allowed === false`) and is shown to a member who is in the Garage. | `cockpit.js:5110`: three strings by state: signed out ("Off. Sign in to share road feel."), signed in and off ("Off. Turn on Share road feel above."), on ("Sharing banking, bumps and surface."). | `013` reads the signed-in line. |
| U-117 | P2 | fortify (disabled state), evaluate (error prevention) | signed-in `phone/014-account-2.png` (Crash check switch on; Contact name and Phone number empty) | Crash check is on by default (`cockpit.js:135` `crash: true`) with no contact to tell, so the switch promises a thing it cannot do, and nothing says what happens on a crash with no contact. | Either the switch is off until a contact is entered (and the row says "Add a contact to turn this on"), or the row says what it does without one ("Calls 911 after 60 s with no answer"; whichever is true) under "How this works", expanded by default while unset. | `014` shows either an off switch with the reason or the behaviour in words. |
| U-118 | P2 | fortify (loading state), evaluate (user control) | billet `phone.mp4 @ 09:06` ("● ● ● /1000", "Open in the Log" solid), `phone/103` ("555", "Share card" solid) | While the worker scores, the card's primary key is Open in the Log; when the score lands the primary becomes Share card. The key swaps under a reaching finger. | `web/cockpit.js` `showEndCard` (`:5790`): fix the layout at first paint: Share card solid from the start when a score is expected (the pending dots in its place), Open in the Log always the link; only a drive with no score at all gets the other layout. | The two frames show the same keys. |
| U-119 | P2 | carplay, own eye | free-drive `car/007` to `019`, guided-drive `car/002` to `012`, `063` to `065`, `100`, `150` (the OPEN plate under the arrow at road-sign size for the whole stretch) | On the car the sight plate's OPEN state is the loudest object on the screen, louder than the guidance card, and it says that nothing restricts the view. | `web/carmap.js` / `CarPlay/ApexCarMap.swift` `drawSight`: when open, draw the eye glyph alone at half the plate's height (or nothing); the full plate only when it carries a number; keep red for "faster than you can see". | `free-drive/car/007` shows a small glyph or no plate. |
| U-120 | P2 | carplay, articulate | free-drive `car/002` to `019` ("-- arrival · -- min · -- mi" for the whole drive) | The record card's trip strip is three dashes for five minutes: honest and dead. CarPlay lets a session carry no estimates. | `ApexCarPlay.swift` `driveStarted` for the record card: start the session without travel estimates (do not call `updateEstimates`), or put the time driven and distance driven there if Apple's strip must show something. | `002` shows no strip or the time driven. |
| U-121 | P2 | fortify (empty state), evaluate (recognition) | signed-in `phone/001-friends.png` to `004` (one sentence, one key, the rest empty), `006-crews.png` to `011` ("A crew is a group…", "Find or start a crew · 1 ›", the rest empty); the four scroll steps of each are identical | The first-use empty states explain in a sentence and show nothing: no sample of a friend on the map, no picture of a crew page, no sense of what arrives here. The sentence is good; the page under it is void. | `web/cockpit.js` People mount: under the key, a dimmed sample row of what will appear (a face, "@handle", "Driving · Dry Ridge Rd · about 10 min ago · within a mile") captioned "What a friend looks like here", and for Crews a dimmed crew tile (crest, name, next drive, board) captioned the same way; both static, never real data. | `001` and `006` show the sample under the key. |
| U-122 | P2 | own eye | planning `phone/008-route-bar.png` (the camera on Jason Drive and Lincolnshire Road; no route line on screen; the recenter key up) | When the card collapses the camera recentres on the car and the chosen route leaves the screen. | `web/cockpit.js` on card collapse: fit the route and the car together (`fitBounds` of route bounds ∪ car with the bar's padding) instead of recentring; the recenter key appears only after a user drag. | `008` shows the red route and the car in one frame. |
| U-123 | P2 | articulate (one vocabulary) | tabs `phone/017-in-the-log-2.png` to `019` ("Left 5 minus · Corner 1" in the cursor readout) against `005-driving.png` ("EASY LEFT") and `transcript.txt` ("Easy left") | The Log names corners in rally notation while the strip and the voice, by the default `noteWords: 'plain'`, say plain words; the same corner has two names on the same phone. | `web/drive_view.js` readout: name the corner with the same `plainCall` the strip uses when plain words are on, rally codes when they are not. | `017` reads "Easy left · Corner 1". |
| U-124 | P2 | own eye, impeccable (craft floor: nothing cut) | billet `phone/002` to `004` ("oad: Northwest Expressway": the R under the dial), guided-drive `phone/002` (the line starts at the dial's rim) | A long road name on the binnacle starts under the dial; in Billet the first letter is hidden. The contract says nothing on the binnacle is cut. | `web/index.html` `.cluster-center > .dna-arch` (`:450`): `padding-left` past the dial's rim and `min-width: 0` on the centre cell, or the Road line on its own row under Limit and Sight at 13 px; the theme contract test asserts the line's box does not intersect the dial's. | `billet/phone/002` reads "Road: Northwest Expressway" whole. |
| U-125 | P3 | articulate | signed-in `phone/006-crews.png` ("Find or start a crew · 1 ›") | A bare number beside a row: one what? | `cockpit.js:4383` `navRow`: "1 crew near you" as the row's detail, or no count. | The row says what the number counts. |
| U-126 | P3 | articulate | signed-in `phone/015-account-3.png` ("On this phone: 0 drives (0.0 mi), 0 spots, 0 privacy zones, 0 recent places… 0 saved routes (<0.1 MB)… 0.2 MB… (of 9.6 GB allowed)"), `012-account.png` ("First to map a road earns 3×."), tabs `phone/015` ("2026-11-01 8:02 AM · Recorded on this phone") | A scoreboard of zeros, a multiplier of nothing named, and a date set like a database field. | Your data: one line when empty ("Nothing on this phone yet."), counts only for things that exist; "earns 3×" names what is tripled or goes; the Log's date in the device's format ("Today, 8:02 AM" / "1 Nov, 8:02 AM"). | `015` is one line; the Log date is spoken, not ISO. |
| U-127 | P3 | own eye, fortify | billet `phone/103-drive-ended.png` ("Harrison Township · Dry · 54°" over the end card's map), tabs `phone/014` (no plate), free-drive `phone/021-after.png` (idle map after End, no plate at all) | The place plate comes and goes: drawn over the end card in Billet, absent on Roadbook's card, missing from the idle map after a free drive. | `paintIdle` / `showEndCard`: the plate hides while the end card is up in every theme and returns with the idle map after Done. | `103` has no plate; `021` has one. |
| U-128 | P3 | fortify (loading state) | billet `phone/106-replay.png` (black map, an arrow, "Quiet · next corner 0.9 mi" with no road) | The replay opens on a void while the tiles and the road name load. | Open the replay with the camera already fitted to the drive's first kilometre and the trail drawn before the first tick; hold the quiet line's road until known rather than printing the line without it. | `106` shows roads and the trail. |
| U-129 | P3 | own eye, impeccable (distill) | tapedeck-night `phone/003-drive-started.png` ("LIMIT 70" caption under the speed and the Speed Limit sign reading 70 beside it) | The limit is printed twice a hand's width apart. | Tapedeck binnacle: drop the "LIMIT 70" caption; the sign is the limit. | One limit on the Tapedeck binnacle. |
| U-130 | P3 | own eye (consistency) | billet `phone.mp4 @ 07:47`, `@ 07:50` (Sight cell "30" in red at 0 mph; the plate under the arrow hidden) | The plate hides under 5 mph (U-60) and the cell does not; two displays of one value disagree at a standstill. | `paintSight`: the cell follows the plate's filtered value and shows "--" under 5 mph. | At 0 mph the cell reads "--". |
| U-131 | P3 | activitykit, include | guided-drive `phone.mp4 @ 32:12` (compact island: the record dot and "QUIE") | "QUIET" at caption2 scaled to 0.6 still does not fit the compact trailing region and is clipped, not scaled (`LiveActivity/ApexLiveWidget.swift:91`). | When quiet, compact trailing shows the next corner's distance ("1.0 MI") and leading the dot; `short` for quiet is used in the expanded view only. Any trailing word is at most four characters. | The compact island never shows a cut word. |
| U-132 | P3 | impeccable (browser surfaces) | signed-in `phone/013-account-1.png`, `016-account-4.png` (a thin scrollbar at the right edge of the Garage) | A browser scrollbar in a native-looking sheet is the cheapest tell that this is a web view. | Garage and Log sheets: `scrollbar-width: none; ::-webkit-scrollbar { display: none }` (iOS shows its own overlay indicator anyway). | No scrollbar in any Garage photo. |
| U-133 | P3 | own eye, impeccable (layout) | guided-drive `phone/050-driving.png` (three-line head plus three-line modifiers; the strip ~70 px taller) against `100-driving.png` (the quiet line; the map's top edge and the arrow 70 px higher) | The strip's height changes with the call, so the map, the arrow and the sight plate step down and up between calls. | `.rb-box.now`: a fixed strip height equal to the tallest case (three-line head and two-line modifiers), the map's top edge fixed; or animate the height over 180 ms. | The map's top edge is at the same y in every driving photo of a flow. |
| U-134 | P3 | articulate, own eye | guided-drive `phone/001-route-from-gpx.png` ("1 café" with a glyph that reads as a mountain or tent; "Ahead: Esses at 2.4 mi · Technical at 3.4 and 8.5 / mi" with "mi" alone on its line) | The café glyph (REVIEW3's open item) still is not a cup; a unit orphaned on its own line. | A cup glyph in the facts' icon set; `white-space: nowrap` on "8.5 mi" (wrap the sentence at the "·"). | `001` shows a cup and no orphaned unit. |
| U-135 | P3 | articulate, app-store-review | signed-in `phone/016-account-4.png` ("Share app health" on, "How this works +" collapsed), `015-account-3.png` ("Attach diagnostics" on) | Both default-on switches are anonymous daily counts and app version numbers, declared as diagnostics (`docs/APP_REVIEW.md` 5.1.2, `web/health.js:1`), which is fine; the rows do not say "anonymous" until the fold is opened, and a reviewer or a careful member reads a default-on data switch first. | The row's own label: "Share app health (anonymous counts)" and "Attach diagnostics (app version, device, no position)". | The words are on the row, not behind the fold. |
| U-136 | P3 | carplay | guided-drive `car/020-driving.png` (the "R3" plate against the guidance card's right edge) | A corner plate still lands at the card's edge (U-77's remainder). | `web/carmap.js` `placePlates`: exclude the card's `inset` rectangle plus 12 px. | No plate touches the card. |
| U-137 | P3 | own eye | guided-drive `phone.mp4 @ 24:59` ("Road: --" at 18 mph in the junction while the strip says "Sharp right, like a junction" and the map labels the road) | The binnacle's road goes unknown for a beat at a junction the app knows it is in. | Hold the last road name for 5 s when the matcher has none. | No "Road: --" inside a called junction. |

Counts: P0 1 · P1 7 · P2 11 · P3 13 (32 findings, U-106 to U-137).

---

## 4. The voice

Timed from the two flows that replayed at real speed (Billet and Tapedeck, leads at the strip's distance when the line was
logged, speeds from the dial in the same frame):

| call | Billet | Tapedeck |
|---|---|---|
| Tight right, careful | 850 ft at 67 mph (8.6 s) | 750 ft at 65 (7.9 s) |
| Very sharp left, almost back on itself, long | 400 ft at 34 (8.0 s) | 450 ft at 34 (9.0 s) |
| Quiet from here. Bumps and cameras only. | on Carolina Trace at 38, next corner 1.5 mi | the same |
| Easy left, then 400 feet | 300 ft at 47 (4.3 s) | 400 ft at 45 (6.1 s) |
| Easy right | 200 ft at 37 (3.7 s) | 300 ft at 36 (5.7 s) |
| Medium right | 250 ft at 36 (4.7 s) | 300 ft at 37 (5.5 s) |
| Open left | 350 ft at 49 (4.9 s) | 300 ft at 49 (4.2 s) |
| Sharp left, like a junction, careful | 600 ft at 45 (9.1 s) | 550 ft at 45 (8.3 s) |
| sign-off | "Complete. Score, five hundred fifty-five." | "Five hundred sixty-one. That's a wrap." |

- **Timing.** Nothing lands inside a corner (U-96 holds); the tight corners get eight to nine seconds, the easy ones four
  to six. Four seconds on an easy corner at 37 mph is the floor, not a fault. The passed corner moves on while the car
  stands in it (`billet/phone.mp4 @ 07:47` to `@ 07:50`), so U-86 is confirmed.
- **Density.** Nothing on the interstate, everything on the road, the quiet line said when the road straightens and the
  notes back when it bends again, with the "Full notes." line as the wake word (the owner's clip to record). Right.
- **Wording.** "careful" twice in nine minutes, on the corners that earn it: right. "Easy left, then 400 feet" is a
  sentence without an object (U-109). "Full notes." as the wake line is still the mode's name.
- **Character.** The three transcripts differ in one line. The theme cards quote lines ("Easy in, late out") that are never
  said (U-113). The sign-offs show how much one line of character is worth: keep them, and give each voice three more.
- **The guided flow** said thirteen lines in thirty-four minutes because the rig replayed it at a third of real speed; its
  "Easy right" and "Quiet from here" seven seconds apart (08:17:46, 08:17:53) is the rig, not the co-driver.

---

## 5. What the skills got wrong

Rules the checklists raised that are wrong for Vetta, so they are not re-raised next time:

- **impeccable `ios.md`: "San Francisco carries the UI", "platform controls", "semantic system colours", "grouped/inset
  lists for settings".** Vetta is a web cockpit inside a shell on purpose, and its detents, stamps, slide switches, record
  key and three themes are the design, not slop. The iOS rules that do bind are the ones about the body, not the clothes:
  safe areas, 44 pt targets, the edge-swipe back, Dynamic Type for prose (below). The "ported website" test is still worth
  running on the Garage, which fails it for the reasons above (U-132), not because its switches are not UISwitch.
- **impeccable craft floor: the eyebrow ban.** "DRIVE SAVED", "VETTA SCORE", "KIT SAYS", "SCORE", "TRIP" are instrument
  labels under values, not kickers over headings. Keep them. (KIT SAYS goes for the other reason, U-113.)
- **impeccable craft floor: "monospace as a costume"; "light or dark picked by category".** Tapedeck's mono is the object
  it evokes, and the dark cockpit is picked from the use scene (a car at night), which is what the rule asks for.
- **impeccable audit: a global `prefers-reduced-motion` kill (`web/index.html:929`, 0.01 ms on everything).** The audit
  flags it as destroying useful feedback. In a drive screen, instant values under Reduce Motion are the right reading of
  the setting; the needle and the drum are information, not motion for its own sake, and stepping is acceptable. Not a
  finding.
- **evaluate / Intent anti-pattern catalogue: default-on data switches (Share app health, Attach diagnostics) read as
  "prechecked consent".** They are anonymous daily counts and version numbers, declared as diagnostics in
  `docs/APP_REVIEW.md` 5.1.2 and `docs/LISTING.md`, with the switch in the open. Not a dark pattern; a labelling nit
  (U-135). The catalogue also asks about streaks, variable rewards and nagging: there are none. Score and the crew board are
  the owner's design; the one engagement question they raise is in Pushback.
- **include: "WCAG contrast 4.5:1 for all text" applied to the binnacle and the strip.** The theme contract already sets a
  stricter floor for the call and the hazard (7:1) and 4.5:1 elsewhere; the pencil-grey captions ("SCORE", "Sight", the
  quiet line) are the places to measure, and the recording cannot measure them (the frames are composited at 3x). This is
  a recording ask (§7), not a finding.
- **include: "Dynamic Type" everywhere.** The cockpit's sizes are the theme contract's and must not scale; a 21 px call
  at the user's accessibility size would wreck the strip. The Garage, the Log's prose, People and the route card's
  sentences should scale, and today nothing in the web view does (no `-apple-system-body` or text-size hook anywhere in
  `web/index.html` or `ApexNavApp.swift`, read in code; the recording did not exercise it, so it is a §7 ask with a code
  pointer, not a numbered finding).
- **carplay: "map-only content in `CPWindow`".** Vetta's car map draws plates, the sight plate and corner codes in the
  window. These are map annotations in the sense Apple means (Apple Maps draws its own), and the recording shows them
  decluttered; the rule is right in spirit (nothing that behaves like a control in the window) and Vetta keeps it.
- **app-store-review: "login gates", "ATT", "StoreKit".** None apply: there is no gate, no tracking, and nothing for sale
  yet. The one thing it rightly asks about is the "PRO" tags on themes that are free until release: a reviewer may ask what
  PRO buys. Not a finding while the owner's "every theme open until the App Store release" decision stands; the tag's
  wording ("PRO · free for now") is a one-line hedge for the submission build, for the owner.

---

## 6. Roadmap 5

Each item is one PR; the order is the order to build.

1. **The strip's grammar** (U-106, U-107, U-133; `web/instruments.js` `renderNotes`, `web/index.html` strip and
   landscape rules, `web/cockpit.js` `OB_NOTES`): codes in the next cell, words in the head, a fixed strip height, the
   landscape strip with words and a right column that does not overlap, and the theme contract test extended to landscape.
   Build first: it is the P0 and the most visible P1 in one block of CSS and one renderer.
2. **Numbers and sentences that agree** (U-108, U-111, U-118, U-123, U-130, U-137; `web/eta.js`, `showEndCard`,
   `analysis_worker.js` `save`, `drive_view.js`, `paintSight`): the forecast bounded and slow, one coaching sentence, fixed
   end-card keys, one corner vocabulary, the Sight cell following the plate, the road name held through a junction.
3. **The voice** (U-109, U-113; `web/plain_notes.js`, the Tapedeck renderer, `renderThemePicker`): the chain says its
   corner; Kit's box and the cards' quoted lines go until the packs exist (the packs themselves are the owner's recording
   session, OWNER_TODO).
4. **The car's words and plates** (U-112, U-119, U-120, U-136; `CarPlay/ApexCarPlay.swift`, `web/carplay.js`,
   `web/carmap.js`, `ApexCarMap.swift`): short instruction variants, the OPEN plate quieted, no dead trip strip, plates
   clear of the card.
5. **The replay's end and start** (U-110, U-128; `web/cockpit.js` replay tick and `openReplay`).
6. **Planning surfaces** (U-114, U-115, U-122, U-134; `cockpit.js:2074`, `web/route_card.js`, the collapse handler).
7. **The Garage and People** (U-116, U-117, U-121, U-125, U-126, U-132, U-135; `web/cockpit.js` Garage and People
   mounts): the state-wrong strings, Crash check's honest state, sample rows in the empty states, the counts and dates, the
   scrollbar. This PR is also where REVIEW3's Roadmap 3 item 1 (the Garage's sections behind rows) should finally land; the
   overhaul in §2 is that item.
8. **Small things** (U-124, U-127, U-129, U-131; the binnacle's Road line, the place plate, Tapedeck's caption, the
   island's quiet word).

---

## 7. The recording itself

1. **The guided drive replays at a third of real speed** (0.83 mi in 129 s against Billet's 44 s; 257 steps to 3.6 mi; no
   End, no Log). Shooting the phone and the car every 3 s is starving the replay's clock. Drive the replay from the
   recording's own timestamps (sleep until the sample's time, not a fixed tick) so screenshots cannot slow it, or shoot
   every 6 s on the guided flow; and assert the drive reached End before the flow passes.
2. **The tabs flow's Log, People and Garage steps still photograph the replay** (`tabs/phone/022` to `038`): the tab taps
   land on a hidden tab bar and the scroll gestures pan the map. Tap Done (it exists now) before the tab steps, and assert
   the tab bar is visible before tapping it.
3. **Planning's `005` to `007` and signed-in's `002` to `004`, `007` to `011` are identical frames**: the scroll had nothing
   to scroll. Skip a scroll step when the page's scroll height fits, or drop the steps.
4. **The welcome's own strip** is now the first thing a new driver sees: add a step that holds on it for one full cycle so
   each of the five demo calls is photographed (U-107).
5. **Landscape got six frames at one moment**; add a landscape step on a corner call and one at the quiet line, and one
   landscape frame of the car's phone-side report sheet.
6. **A contrast pass**: dump the computed colours of the quiet line, the captions ("SCORE", "Sight", "MPH") and the
   pencil links per theme (day and night) from the page (`getComputedStyle`), not from the PNGs, into the pack's notes,
   with the ratio against their surface.
7. **A Dynamic Type step**: launch once with the largest accessibility text size and photograph the Garage, People, the
   route card and the Log page; the cockpit should be unchanged and the prose should grow.
8. **The island's quiet state** (`@ 32:12` was caught by luck at the flow's end): add a home-screen step during the
   quiet line as well as during a note.
9. **The lock screen Live Activity** is still judged from code only; the simulator can show it (`simctl` lock) and should.

---

## 8. Pushback

- **The live Score in the binnacle.** It fell from 623 to 577 through the hairpin and sat there (`guided-drive/phone/050`
  to `219`). A number that moves while you drive is a thing to glance at, and the only way to move it is to drive
  differently; that is the mechanic REVIEW.md's "Not doing" list was written against. I would hold the Score until End (the
  binnacle shows "--" or the last drive's score) and let the end card be the reveal.
- **Two reds, one hand apart.** Still open from Review 4: the Sight cell is red at all times by the contract while the
  plate under the arrow is red only when you are faster than it; at 0 mph the cell is red with "30" in it while the plate
  has hidden itself (U-130 fixes the value, not the colour). Red should mean one thing on the drive screen.
- **The crew board ranks the total of drive Scores** (CALL_SHEET 2026-10-31). A total rewards driving more, not better;
  it is the one place the app's incentive points at volume. A median of the member's last ten drives, or the best, keeps
  the board about technique.
- **"PRO" on themes that are free.** The owner's decision to open every theme until release stands; the tag should say so
  in the submission build ("PRO · free for now") so neither a reviewer nor a member reads a price that is not there.
