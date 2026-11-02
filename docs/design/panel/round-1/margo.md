# Margo Lindqvist, the co-driver: round 1

Evidence: recording 6 (`scratchpad/r6`). The transcripts with their times are my main evidence, set against the
videos: a frame named `guided-drive/phone.mp4 @ 04:13` is the frame I pulled at that minute and second, and the
distance and speed I quote are what the strip and the dial read in it. Where I name a file in `web/` I read the code.
Every drive in the pack was in plain words, which is what every new driver gets (`web/cockpit.js:134`,
`noteWords: 'plain'`), so plain words are what I judged.

## First impressions

I have sat in the left seat for twenty years, and the first thing I do with anything that calls itself a co-driver is
close my eyes and listen. So I did: the Billet drive, 19:37 to 19:43, no screen.

The timing is right. I did not expect that. "Tight right, careful" comes at 800 feet with the car at 65, which is a
little over eight seconds; the hairpin at 350 to 450 feet at 34, nine seconds; the easy stuff at four to six. The
interstate is silent. When the road straightens she says so, and when it bends again she is back before the first
corner. "Careful" is spent twice in nine minutes, on the two corners that deserve it. And the sign-off is a human
being: "And that's the stage. Score five hundred fifty-seven." I have worked with licensed co-drivers who could not
manage that discipline in a season. Whoever built the timing understood that a note is a promise about a moment, and
kept it.

Then I opened my eyes and listened to the words, and the words are a navigation app wearing my headset.

"Very sharp left, almost back on itself, long." Ten syllables for a corner any driver in any pub would call a hairpin.
"Sharp left, like a junction, careful": a simile, at 45 mph. The warning word, the one word a driver must hear before
anything else, is put last, after the description, and in a chain it is buried in the middle of the sentence. Then,
four seconds after the hairpin call, with the car 100 feet from the corner at 22 mph, she adds "Brake well before this
one." The driver is already braking, or already in the hedge. Advice given after its moment is not character; it is a
co-driver talking to hear herself.

And the page does not agree with the voice. The head says TIGHT RIGHT in plain words while the next cell says L5- and
LAC in a code I had to look up (there is no LAC in any notation I have read), and the car draws R4 on the map under a
card that says "Open left". In the town of Harrison the app calls every street corner a corner, "careful" included, at
16 mph. Kit, the fox, writes "Square one. Tidy does it" under a strip that will not use the word square.

What I would tell a friend: the ears of this thing are real; the mouth needs a season with a good co-driver. The good
news is that the fixes are words and order, which is the cheap part. The timing, which is the expensive part, is done.

## Proposals

### M-1: A call grammar: warning first, one short word per thing, said in the order a driver uses them

**Why it matters.** A pace note is not a description of a corner; it is an instruction in the order the driver needs
it: the warning, the direction, how tight, what it does, what comes next. The plain words today are a description in
the wrong order. "Tight right, careful" (`guided-drive/transcript.txt` 19:39:48; `billet` 19:37:51) puts the one word
that changes the driver's hands at the end of the sentence. "Sharp left, like a junction, careful, then easy right in a
quarter mile" (`guided-drive` 19:54:58) buries it in the middle. "Very sharp left, almost back on itself, long"
(`guided-drive` 19:40:46, strip `guided-drive/phone.mp4 @ 04:07`: VERY SHARP LEFT on two lines, ALMOST BACK ON ITSELF
· LONG · CAREFUL under it) is ten syllables for "hairpin"; "Sharp left, like a junction" (19:45:12) is a simile for
"square". And the scale itself is three near-sounds for three different things: Tight (severity 2), Sharp (square) and
Very sharp (acute). At 60 mph with the window down, "tight" and "sharp" are the same word. The fox already knows the
right word (`tapedeck-night/phone.mp4 @ 08:43`: strip "SHARP LEFT · LIKE A JUNCTION", Kit "SQUARE ONE. TIDY DOES IT").

**What to build.** `web/plain_notes.js`, `plainCall` and `plainChain`, plus the tests in `tests/test_plain_notes.py`:
- Order: caution, then the corner, then its modifiers, then the link. "Careful, tight right." "Careful, hairpin left,
  long." In a chain the caution sits in front of the corner it belongs to: "Open left, then careful, square left in
  200 feet."
- Words: hairpin (HP and acute both; acute has no plain word and a driver treats them the same), square, tight, medium,
  open, easy, slight. Drop "very tight" (severity 1 becomes "tight", the tulip and the rally code keep the grade) and
  drop every simile. Every word of the scale must be a different sound: tight / square / hairpin are.
- Modifiers stay one word each: tightens, opens, long, over a crest, off-camber ("slopes away" is fine).
- The strip's lockup (`web/instruments.js` `lockup`) keeps the head as the corner and prints the caution first in red;
  the chained-call text and the Live Activity's expanded line use the same string.
- Rally words are untouched; this is the plain pack only.

**Cost.** M (the words are an afternoon; the voice bank needs the new clips rendered by `tools/voicebank.py`, and the
timing estimate `speakS` gets shorter lines for free).

**Done looks like.** The transcripts read "Careful, tight right", "Hairpin left, long", "Square left"; no call over
six words before its link; the strip head and the voice use the same word for the same corner.

### M-2: Advice rides with the call or is not said; asides never land inside the braking zone

**Why it matters.** The packs' asides are the only character on tape and they are timed like an afterthought. Billet
and the guided drive: hairpin call at 19:40:46, "Brake well before this one." at 19:40:50, and at
`guided-drive/phone.mp4 @ 04:13` the strip reads 100 FT at 22 mph, the car already slowed from 33. "Brake in a
straight line." comes five seconds after the junction call both times (19:45:12 / 19:45:17; 19:49:33 / 19:49:39),
when a driver at 45 has 300 feet left. Worst, 19:55:58 "Easy left, long, then square left in a quarter mile" and six
seconds later "It goes on a while." (19:56:04): the last corner named was the square one, so the aside now describes
the wrong corner. In code the aside may start as late as `lastCallM` (`web/cockpit.js:1298`, `web/note_timing.js`
`lastCallM`): the same last-moment rule as a call, which is exactly the moment a driver must not be given advice.
`web/voice_lines.js` `asideToken` also fires on a chain of one note that names a next corner, which is what happened.

**What to build.**
- Split the asides into two kinds in `web/voice_lines.js` PACKS: instruction ("Brake before it, not in it", "Late
  apex", "Brake straight") and colour ("Long one. Settle in", "Proper tight one"). Instructions become part of the call
  line, spoken in the same breath after the corner ("Careful, hairpin left, long. Brake before it."), and only when the
  call's lead at this speed leaves `speakS` of the longer line plus the beat; else they are dropped, never deferred.
- Colour asides keep `createAsides` but `dueByM` becomes `atM - leadM(...)`: the aside must end before the point where
  the driver would brake, not before the corner. If it cannot, it is not said.
- No aside after a call that names a next corner (`opts.next` set in `plainChain`): the chain is the last word.
- Kit's box shows the aside at the pre-call and clears when the head changes (it does; keep that).

**Cost.** S.

**Done looks like.** In the next transcripts every "Brake…" line is inside the call's own sentence, no aside starts
under 4 s from the corner, and no aside follows a "then … in" line.

### M-3: One notation on the page: the next cells, the car's plates and the Log say what the head says

**Why it matters.** A written road book has one notation. The strip's head is in plain words while the next cells are
in rally codes with a grade the plain driver was never taught: TIGHT RIGHT beside "0.7 MI · LAC" (`guided-drive/
phone.mp4 @ 03:09`), VERY SHARP LEFT beside "L5-" (`@ 04:07`), MEDIUM RIGHT beside "L4+" (`billet/phone.mp4 @ 07:47`),
EASY LEFT beside "LSQ" (`guided-drive/phone.mp4 @ 19:25`), SHARP LEFT beside "RSQ" (`tapedeck-night/phone.mp4 @
08:43`). LAC, LSQ, RSQ are not a notation anyone has read in a car; they are `paceNoteText`'s codes
(`web/apex_core.js:403` to `:409`) printed raw by `stripCode` (`web/instruments.js:78`). The car does the same: a plate
"R4" on the map under a card that says "Open left" (`guided-drive/car/024-car-guide.png`), "R3" beside "Tight right,
careful". The driver who chose plain words is shown rally codes everywhere but the head, and even a rally driver is
shown codes that are not rally.

**What to build.** `web/instruments.js` `stripCode(n, words)`: in plain mode, a short plain word pair, "TIGHT R",
"HAIRPIN L", "SQUARE L", "EASY R", "OPEN L" (eight characters, fits the cell the codes fit); in rally mode, real
notation: L1..L6 with grade, "L HP", "SQ L" and acute folded into HP (there is no code for it because there is no such
note). `web/carmap.js` `placePlates` and `CarPlay/ApexCarMap.swift` take the same function for the map plates. The
Log's cursor readout (`web/drive_view.js`, U-123) already follows the words mode; check it after the rename.

**Cost.** S.

**Done looks like.** No "LAC", "LSQ", "RSQ" anywhere; in a plain-words drive every photo of the strip and the car map
shows plain words only; in a rally drive codes only.

### M-4: A route through a town is read as junctions, not corners

**Why it matters.** From 19:53:43 to 19:56:04 the co-driver called six corners in 2 min 21 s in the grid of Harrison
(Madison Street at `guided-drive/phone.mp4 @ 17:28`, Park Avenue at `@ 18:19`, Harrison Avenue at `@ 19:25`), at 16
to 29 mph, with "careful" on a street corner at 16 mph ("Sharp left, like a junction, careful, then easy right in a
quarter mile", 19:54:58). Those are junctions; a co-driver reads them as junctions ("junction left onto Park, then
right, 200") or says "town, half a mile" and shuts up. The app hides corners that sit on a junction only when the
route has steps (`ApexDirections.atJunction(track.steps, …)`, `web/cockpit.js:1465`); a GPX route has none
(`guided-drive/phone/001-route-from-gpx.png`), so every street corner on a GPX drive is a stage corner and "careful"
is spent on it. "Careful" is a currency; spending it at 16 mph in a town is how a driver learns to ignore it at 60.

**What to build.** When a route is loaded from GPX or drawn as a loop, map-match it and fetch its maneuvers the way a
searched route gets them (the same Valhalla trace call `web/route_import.js` or `web/fun_route.js` would use for
`steps`), so `atJunction` and the directions' own "turn left onto" calls apply. Where no steps can be had, a corner
whose entry lies within 30 m of a mapped intersection on a residential or tertiary way is read as "Junction left" /
"Junction right" with no caution and no chain. Either way, a run of three or more junction notes within 500 m becomes
one line: "Town for half a mile." and the strip's quiet line; notes resume at the first real corner.

**Cost.** M.

**Done looks like.** In the guided drive's Harrison stretch the transcript shows junction lines or one "Town" line and
no "careful"; the corner calls on New Biddinger Road and Dry Ridge are unchanged.

### M-5: The quiet line says how long the quiet is; the wake line says the first corner

**Why it matters.** "Quiet from here. Bumps and cameras only." is seven words that describe a setting, said three
times in one drive (`guided-drive` 19:41:36, 19:45:57, 19:50:16); "Full notes." is the mode's name, said twice
(19:39:30, 19:53:11). A co-driver never announces a mode. She says what the road does: "Straight for two miles" is a
note; the strip already knows it ("Quiet · next corner 0.8 mi", `guided-drive/phone/002`), the voice does not say it.
The free drive is the proof that the wake line is empty: "Full notes." at 20:01:27 and then nothing for 3.1 miles
(`free-drive/transcript.txt`; the strip reads "The road ahead · Full notes" with no corner in it, `free-drive/
phone/004` to `008`). The co-driver woke up, said the name of her job, and had no note to read.

**What to build.** `web/voice_lines.js` PACKS and `web/cockpit.js` where `createWakeVoice` returns 'on' / 'off':
- Off: "Quiet for {distance}." using the distance to `nextWake` (`web/note_timing.js`), rounded to the rally
  distances, with the `navd:` clips already in the bank for the number ("Quiet for two miles." / "Quiet, half a
  mile."). Kit: "Nothing for two miles." Hale: "Clear, two miles."
- On: the first call carries the wake: no "Full notes." when a corner call follows within 10 s; the call itself is
  the wake. When Auto wakes with no corner within the window (the free drive), nothing is said.
- Keep "Bumps and cameras only" as the strip's text, not the voice's.

**Cost.** S (words and one distance; clips rendered by `tools/voicebank.py`).

**Done looks like.** Transcripts contain "Quiet for …" with a distance and never a bare "Full notes." as the first
and last thing a drive says.

### M-6: A chain reaches as far as a co-driver's arm, not a quarter mile

**Why it matters.** Four lines in the guided drive end "… in a quarter mile" (19:51:13, 19:54:07, 19:54:58,
19:55:58). A quarter mile is 1,300 feet; at 30 mph that is thirty seconds. A chain exists so the driver carries the
second corner through the first; thirty seconds later nobody is carrying anything, and the second corner then gets
no call of its own because it was "chained". `linkNotes` chains up to `LINK_MAX_M = 500` (`web/apex_core.js:29`,
`:447`), which is the rally road-book's limit for a printed distance, not a spoken one. And at `guided-drive/phone.mp4
@ 17:28` the voice is calling "Tight left, then square left …" while the strip still shows MEDIUM RIGHT at 0 FT: the
page and the voice are on different corners.

**What to build.** In `chainedCall` (`web/cockpit.js:1257`) and `plainChain`'s `next`: speak the link only when the
gap is at most 150 m (500 feet) or under 6 s at the current speed; beyond that the chain ends at the first corner and
the second corner is called on its own at its own lead. The strip keeps printing the printed distance ("0.4 mi to
next") because a page may say what a voice should not. The rally chain keeps its bare number, as the owner decided,
under the same 150 m cap.

**Cost.** S.

**Done looks like.** No "then … in a quarter mile" in any transcript; every corner over 500 feet from the last gets its
own call at its own lead.

## What I'd protect

1. **The lead timing and the silences.** 800 ft at 65 for a tight corner, 350 to 450 ft at 34 for a hairpin, nothing
   on the interstate, back before the first corner when the road bends (`billet/transcript.txt`, the strip frames
   above). `web/note_timing.js` is right; touch the words, not the clock.
2. **"Careful" once a run** (`createCareRun`) and the no-call-inside-the-corner rule (`lastCallM`). Two corners in nine
   minutes got the word, and nothing landed after the entry on the open road. That discipline is the product.
3. **The sign-offs in three voices** and the end card that says the same number the voice does ("And that's the
   stage. Score five hundred fifty-seven." / "Five hundred fifty-three. That's a wrap." / "That's the last corner.
   Lovely road. Score seven hundred eighty-eight."). One line each, and each one is a person.
