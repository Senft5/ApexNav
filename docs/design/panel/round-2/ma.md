# Margo Lindqvist, the co-driver: round 2

Evidence: recording 7 (`scratchpad/r7`). The transcripts are my main evidence, set against the videos: a frame named
`guided-drive/phone.mp4 @ 07:12` is the frame I pulled at that minute and second, and the distance and speed I quote
are what the strip and the dial read in it. Every drive is in plain words, which is what every new driver gets, so
plain words are what I judged. Where I name a file in `web/` I read the code, and where I say a thing cannot happen I
ran the numbers through `web/note_timing.js` myself.

## First impressions

I closed my eyes again. The guided drive, 02:10 to 20:34, eighteen minutes, no screen.

The grammar landed. "Careful, tight right" at 600 feet and 61 mph (`guided-drive/phone.mp4 @ 02:31`), the warning
first, red, on its own line. "Hairpin left, long" at 350 feet and 34. "Careful, square left." Not one simile, not one
call over six words before its link, and the page says what the voice says: HAIRPIN L in the next cell, TIGHT R on
the car's plate, "Careful, tight right" on the car's card (`guided-drive/car/007-car-guide.png`). The clock is
untouched. Round 1 asked for words and order, and got words and order. Good.

Then the drive went on, and three things a real co-driver would be sacked for happened, and they are all the same
kind of thing: the voice announcing its own machinery.

First, "Quiet from here. Bumps and cameras only." said at 07:10 with OPEN LEFT at 600 feet on the page and a careful
square left half a mile behind it, and six seconds later: "Open left." Then the same trick at 12:30/12:36 and
17:37/17:43. Three times in one drive she said "I'm going quiet" and then read the next corner before the sentence
had cooled. Second, "careful" seven times in eighteen minutes, twice on the same corner forty-nine seconds apart,
because the chain says "then careful, square left in a quarter mile" and then the corner's own call says "Careful,
square left" again. That one is my own grammar coming back to bite me, and I will own it below. Third, the thing
nobody will hear: in thirty minutes of tape across five drives there is not one aside. Not a "Brake before it", not a
"Square one. Tidy does it." Round 1 asked that advice never land in the braking zone. What was built is a gate that
cannot open at any speed for any line, and Kit's box sits empty for nine minutes (`tapedeck-night/phone.mp4 @ 08:59`).

The ears are still real. The mouth now has the right words and a mode machine behind it that talks too much about
itself. The fixes are cheap, and three of them are in one file.

## Proposals

### MA-1: Quiet means quiet: the notes never go to sleep with a corner on the page, and never wake within a minute of saying so

**Why it matters.** The mode flaps at its own edge, and the voice narrates the flapping. `guided-drive/transcript.txt`:
23:54:14 "Quiet from here. Bumps and cameras only." then 23:54:20 "Open left"; 22:59:34 "Quiet…" then 22:59:40 "Open
right"; 23:04:41 "Quiet…" then 23:04:47 "Easy right, then easy left in 350 feet". At `guided-drive/phone.mp4 @ 07:12`,
two seconds after "quiet", the strip reads OPEN LEFT · 600 FT with SQUARE L at 0.5 mi beside it, at 47 mph. A
co-driver who says "nothing for a bit" with a corner six hundred feet away is not believed on the next stage.

The mechanism is in the code and it is exact. Auto stays awake for 30 s after the last waking corner (`web/cockpit.js:1082`,
`isSpirited`), then says "off". The next corner wakes it at two leads or 800 m (`web/note_timing.js` `WAKE_MIN_M`),
and the 120 s gap (`TRANSITION_GAP_MS`) only silences the "Full notes." line, not the call that follows it. So at the
800 m edge the voice says quiet, the corner crosses the line, and the call comes out six seconds later. The hysteresis
is on the announcement, not on the state.

**What to build.** In `web/note_timing.js` and `updateNotes` (`web/cockpit.js:1385` to `:1392`):
- Sleep has its own, wider window: Auto goes quiet only when no waking corner lies within `2 × wakeWindowM` (at least
  1600 m) **and** nothing is on the strip within its lead. Wake stays at 800 m. One number in, one number out, never
  the same number.
- The "off" line is a note, not a mode: "Quiet for {distance}" with the distance to `nextWake`, rounded to the spoken
  distances in `web/units.js` `spokenShort` ("Quiet for two miles." / "Quiet, half a mile."). Kit: "Nothing for two
  miles." Hale: "Clear, two miles." Under half a mile nothing is said at all: the quiet is too short to announce.
- The "on" line is the first call. No "Full notes." when a corner call follows within 15 s, and nothing when Auto wakes
  with no corner in the window (the free drive: "Full notes." at 22:50:15 and then 3 miles of silence under a strip that
  said "The road ahead · Full notes", `free-drive/phone/004` to `017`). The drive's first line is its first corner.
- `createWakeVoice`'s gap stays, as the backstop.

**Cost.** M (the state change is S; the distance line needs the `navd:` number clips the bank already has, stitched
by `tools/voicebank.py`).

**Done looks like.** In the next guided drive no corner call within 45 s after a "Quiet" line; every "Quiet" line
carries a distance; the free drive's transcript has no "Full notes." and no line at all until a corner.

### MA-2: A chain reaches 500 feet, and "careful" is spent once per corner, not once per mention

**Why it matters.** Eight of the twenty-eight lines end "in a quarter mile" (23:00:20, 23:03:13, 23:04:02, 23:05:01,
23:05:35 and the rest). A quarter mile at 28 mph (`guided-drive/phone.mp4 @ 16:11`) is 32 seconds; nobody carries a
corner that long, so the named corner gets its own call anyway, and now the caution is said twice: 23:03:13 "Tight
left, then careful, square left in a quarter mile" and 23:04:02 "Careful, square left, then easy right in a quarter
mile"; again 23:05:01 / 23:05:35. Seven "careful"s in eighteen minutes for five corners. Round 1 had two in nine. In
the code the chain's next corner is named by `plainNamed(next)` (`web/plain_notes.js:61`) with its caution raw, while
`createCareRun` (`web/note_timing.js:135`) only gets to `take()` the notes inside the chain
(`web/cockpit.js:1272`), never the named one. I asked for "then careful, square left in 200 feet" in M-1 and the
builders did exactly that. At 200 feet it is right; at a quarter mile it is the same word twice, and the second time
it means less.

**What to build.**
- `chainedCall` (`web/cockpit.js:1257`): name the next corner only when the link is at most 150 m or under 6 s at the
  current speed (`Number(cur.link) <= Math.max(150, vMps * 6)`); beyond that the chain ends at the corner and the next
  corner is called on its own at its own lead. The strip keeps printing "0.4 mi" in the next cell, because a page may
  say what a voice should not. The rally chain keeps its bare number under the same cap, as the owner decided.
- When the next corner is named with its caution, that is the run's "careful": `run.take()` for `next` as for the chain's
  own notes, and the corner's own call then comes without it ("Square left"). One word, one corner.
- `tests/test_plain_notes.py`: a chain at 400 m names nothing; a named "careful" is not said again by the same corner.

**Cost.** S.

**Done looks like.** No "then … in a quarter mile" in any transcript; no corner gets "careful" twice; in the guided drive
"careful" is said at most once per run of corners, which on this road is four times, not seven.

### MA-3: The packs are silent: the aside gate never opens, so open it the way round 1 actually asked

**Why it matters.** Five drives, 44 spoken lines, zero asides. Round 1's tape had "Brake well before this one." and
"It goes on a while."; round 2's has none, and Kit's dot-matrix box is empty from 03:26 to 09:23
(`tapedeck-night/phone.mp4 @ 03:47`, `@ 08:59`). The owner chose to build the packs (CALL_SHEET 2026-11-01, U-113),
and a voted proposal (M-2, 2 points, "built") has quietly turned them off.

It is not bad luck; it is arithmetic. `packAside` (`web/cockpit.js:1298`) picks an aside only if the call's end
(`callEndM`) is before `asideDueByM`. For colour, `asideDueByM` is `atM - leadM(call)`: the point where the call
itself begins. A line that must end before the call begins, chosen after the call, can never fit. For advice, the
due point is `atM - v·(speak + 1.2) - brake` while the call ends at `atM - 2.4·v - brake`, so advice fits only when
its line takes under 1.2 s, about eight characters; the shortest line in the packs, "Late apex." (`web/voice_lines.js:127`),
misses by two metres. I ran all four combinations through `note_timing.js`: `fits false` every time.

**What to build.** What M-2 said, not what it became:
- Advice rides inside the call. `plainChain` takes `opts.advice` and appends it as the call's last clause ("Careful,
  hairpin left, long. Brake before it."); for rally words the aside's token is appended to the call's clip list so the
  bank plays it in the same breath. The lead is computed from the longer line (`leadM` already takes `text`), so the
  call simply starts earlier; and advice is dropped when the longer line's `lastCallM` would be missed. One
  utterance, one moment, no second gate.
- Colour keeps its own clip after the call, with the window measured from the call's end, not its start:
  `callEndM + v·speakS(aside) <= atM - v·ASIDE_MIN_S`, and no next call due inside that. That is what "before the
  driver has anything to do" means; the present formula says "before the co-driver had anything to say".
- Keep the rest: one every 45 s, never after a warning, never after a link, never deferred.
- `tests/test_note_timing_v01.py`: for every pack line at 15, 25 and 35 m/s, at least the advice lines fit on a
  hairpin and a square.

**Cost.** S.

**Done looks like.** The next guided drive and tapedeck drive each carry at least two asides; every "Brake…" line is in
the same sentence as its corner; Kit's box is not empty for the whole drive; nothing starts under 4 s from a corner.

### MA-4: A route through a town is read as junctions, not corners

**Why it matters.** Not built in round 1 (1 point), and the Harrison grid is still the worst two and a half minutes of
the tape: 23:02:51 to 23:05:35, eight calls, four of them "careful", at 25 to 30 mph on Madison Street and Harrison
Avenue (`guided-drive/phone.mp4 @ 16:11`, Road: Madison Avenue, 28 mph, TIGHT LEFT at 200 ft; `@ 17:59` Road: Harrison
Avenue, EASY LEFT · LONG with a square left behind it). These are street corners. A GPX route has no steps, so
`atJunction(track.steps, …)` (`web/cockpit.js:1472`) has nothing to hide them with, and every corner of a grid is a
stage corner with a warning on it. "Careful" at 28 mph on a town street is how a driver learns to ignore it at 60.

**What to build.** When a route is loaded from GPX or drawn as a loop, map-match it and fetch maneuvers the way a
searched route gets them (the same trace call `web/route_import.js` / `web/fun_route.js` would use for `steps`), so
`atJunction` and the directions' own "turn left onto" calls apply. Where no steps can be had, a corner whose entry lies
within 30 m of a mapped intersection on a residential or tertiary way becomes "Junction left" / "Junction right": no
caution, no chain, plate "JCT L". Three or more junction notes within 500 m collapse to one line, "Town for half a
mile.", and the strip's quiet line; notes resume at the first real corner. New Biddinger Road and Dry Ridge are not
touched.

**Cost.** M.

**Done looks like.** The Harrison stretch of the guided drive reads as junction lines or one "Town" line, with no
"careful"; the corner calls before and after it are unchanged.

## Did round 1 land?

M-1 and M-3 landed whole: warning first, one word per thing, no similes, one notation on the strip, the car's plates
and its card, and the clock untouched (600 ft at 61 for a tight right, 350 ft at 34 for the hairpin). M-2 landed as a
gate that killed every aside, which was not the ask. The chain's "then careful" is my wording, built faithfully, and at a
quarter mile it is wrong; MA-2 fixes my own call.

## What I'd protect

1. **The lead timing and the no-call-inside-the-corner rule.** `web/note_timing.js` `leadM` and `lastCallM` are right.
   Every proposal above changes what is said and when the mode flips, never when a corner call starts.
2. **The sign-offs, one line each, a person each.** "That's the last corner. Lovely road. Score six hundred." / "Five
   hundred fifty-four. That's the B-side done." / "Notes closed. Have a good one. Score seven hundred ninety-three."
   And the car card's glance form: "Tight left" while the phone says the whole chain (`guided-drive/car.mp4 @ 16:11`).
