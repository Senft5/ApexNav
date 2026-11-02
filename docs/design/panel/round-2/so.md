# SO: Sofia Brandt, UX researcher

Model: Opus. Evidence: recording 7 (`r7/`), flows first-run, planning, tabs, dynamic-type, guided-drive; code where noted.

## First impressions

I ran usability labs for two map apps. The first thing I learned there is that experts can't see what newcomers trip on, and
this panel is twenty experts. Round 1 settled its biggest UX question, whether to explain Sight, Score and Bank before the
first drive, by one persona vetoing another persona (P-3, Dani's veto). Nobody watched a real person try it. That isn't a
design decision. It's a coin toss.

The recording rig is the best research asset I've seen on a project this size, and it's pointed the wrong way. It proves
that screens render. It doesn't measure whether anyone can finish a task: how many taps, where they went back, where they
stalled. The planning flow "failed" because a drag didn't open the card (`planning/006-route-bar`). A newcomer would have hit
that same wall, and we'd have learned it from a person instead of a broken rig.

Here's what I would flag in a lab session from the photos alone. These are mental-model breaks, not taste:

- **Same label, same shape, different consequence.** The welcome's red "● Start" (`first-run/001-007`) closes the welcome.
  It's `finish()` at `web/cockpit.js:6570`. Two screens later an identical red "● Start" key (`first-run/009-idle-map`)
  starts recording a drive at once (`tabs/001-map` → `002-drive-started`). People learn a key's meaning the first time they
  press it. Here the first press teaches them the wrong one.
- **One concept, two numbers, one glance.** In `tabs/005-driving` the map tag reads "50 MPH" with the eye and the binnacle
  reads "48 Sight".
- **Three scores where a newcomer expects one.** The route card shows Twist 56 and Flow 23 on dials, then tiles that read
  "Fun 45" and "Fun 37", over a switch whose middle position is also called "Fun" (`planning/005-route-card-1`). "Fun 45" is
  a third number that appears in no dial (`web/route_card.js:117`).
- **One setting in two places.** Notes Quiet/Auto/Full sits in the Layers sheet (`first-run/010-layers`) and again in
  Garage (`tabs/028-garage-3`).
- **The toggles don't say whether they're on.** An "I" block next to a square, an "O" next to grey (`first-run/010`,
  `tabs/028`). I'd expect most of my participants to guess wrong on at least one of them.

The good news is that the bones are right. The drive-ended card (`tabs/015`) is the clearest screen in the app: one number,
one sentence, one filled key.

## Proposals

### SO-1: One word, one meaning, one place (a vocabulary contract)

**Why it matters.** Every break in the list above is the same failure: the interface teaches two meanings for one thing, or
two things for one meaning. Newcomers don't read definitions. They infer meaning from consistency, and when it breaks, they
stop trusting the app. Evidence:
- the two Starts (`first-run/007` vs `009`);
- Sight 50 vs 48 (`tabs/005`);
- Fun as a mode, a tile score, and the "+7 min for fun" label (`planning/004`, `005`);
- Notes in two places (`first-run/010`, `tabs/028`);
- the plain-words example still says "Slow down, medium left, tightens" (`tabs/028`, `web/cockpit.js:5132`), but the voice
  now says "Careful, tight right" (`guided-drive/transcript.txt` 22:49:33);
- the theme cards preview "LEFT 4 TIGHTENS" (`dynamic-type/012-013`) to a driver set to Plain words.

**What to build.**
- `web/vocabulary.json` lists each user-facing concept once: its name, its one-line meaning, the screen it is set on, and
  its format (Sight: "NN mph", one rounding, one source value).
- Fix the breaks above.
  - The map's Sight tag and the binnacle read the same smoothed value.
  - Drop the "Fun NN" score from the route tiles. Show the time and what differs instead: "16 min · 7 min quicker · fewer
    corners".
  - Notes lives only in Garage. The Layers sheet links to it.
  - The plain-words example is generated from `plainCall`.
  - The theme previews render through `noteCode` and `obNote` in the driver's chosen words.
- Add a test, `tests/test_vocabulary.py`: every term in the contract is set on exactly one screen, and no label string is
  used for two different actions (e.g. "Start").

**Cost: M.**

**Done looks like.** A newcomer never sees two numbers for one thing on one screen, every setting has exactly one home, and
the test fails the build when someone adds a second one.

### SO-2: The welcome's key isn't the record key

**Why it matters.** First run is where the mental model forms, and it is formed on a false premise. The welcome's primary
action is drawn as the record key: red, with the record dot, labelled "Start" (`first-run/001-007`, `web/index.html:1547`).
All it does is close the welcome and ask for location. The next red "● Start" the person sees (`first-run/009`) records a
drive immediately (`tabs/002`). Expect two failure modes:
- someone presses the map's Start expecting "begin", like the welcome, and is suddenly recording a drive in their driveway;
- someone avoids it after learning that it records.

Neither shows up in a rig run, because the rig knows what each key does.

**What to build.**
- The welcome's primary becomes a plain ink key that names its outcome: "Open the map" (or "Show me the roads"). It has no
  record dot and isn't red.
- The red dot key is reserved app-wide for exactly one meaning: record a drive now. The map's Start keeps it.
- Add a test asserting that `.rec-key` appears only on controls that start recording.

**Cost: S.**

**Done looks like.** In `first-run`, the first red dot a person ever presses is the one that starts a drive, and it does
what it looks like.

### SO-3: Turn the rig into a usability lab (task success, not screenshots)

**Why it matters.**
- Twenty reviewers are judging photos. Round 1's open questions, P-3 (explain before the first drive) and I-1 (Dynamic
  Type), went unresolved because nobody had a measure.
- The rig already scripts each flow end to end, so the instrument is 80 % built.

**What to build.**
- Define six benchmark tasks in `UITests/ReviewFlows`, each with a success state and an expert path length:
  1. start a drive on the road you're on;
  2. get a loop of about 45 mi;
  3. drive to a named park ("Winton Woods": today the middle school ranks first and the park third, `planning/002`);
  4. find your last drive's score;
  5. switch the calls to Quiet;
  6. invite a friend.
- For each task, the rig logs taps, elapsed time, back-navigations, and any query that timed out (a dead end). It writes
  them to `INDEX.md` as a table next to last round's numbers.
- A task that takes more than 1.5× the expert path, or dead-ends, is flagged as a regression.
- The real study goes to `docs/OWNER_TODO.md`: five people who aren't car people, the same six tasks, 30 minutes each, run
  before round 3. Recruiting is the owner's call.

**Cost: M.**

**Done looks like.**
- Every recording opens with a six-row task table: taps, time and a pass/fail for each task, plus the change from last
  round.
- Round 3's vote on P-3 cites five real sessions instead of two personas.

### SO-4: Explain behind a tap, only when parked (round 1's open question, answered)

**Why it matters.**
- Round 1 left P-3 at "explain behind a tap instead?"
- The binnacle shows ten readouts at one glance in `tabs/005`, among them "Sight", "BANK +0.0°", "--" over "SCORE", the strip's
  "Clear", and a "SPEED LIMIT –" box. None of them is defined anywhere a newcomer would look.
- Dani's veto was against a screen standing between coffee and the road. A tap the driver chooses doesn't stand in the way.
- Taps while moving would raise a distraction problem, so this is gated.

**What to build.**
- When the speed is under 3 mph, or during a replay, tapping any binnacle readout or the strip's status word opens a
  one-line caption anchored to it. The text comes from SO-1's `vocabulary.json`: "Sight: the speed you could stop within
  what you can see ahead."
- The caption closes on the next tap or after 6 s.
- While moving above 3 mph, these taps do nothing new.
- The welcome's "Watch a replay" says "tap any dial to learn it" once, in the replay's first caption.
- VoiceOver gets the same line as the readout's hint.

**Cost: M.**

**Done looks like.** In a replay or parked, every readout answers "what is this?" in one tap and one line. While driving,
nothing changes, and no screen was added to first run.

## Did round 1 land?

- **Mostly.** The call grammar is audible ("Careful, square left", `guided-drive/transcript.txt` 22:54:46). End → Undo is
  there (`dynamic-type/005`), and "0.6 mi · no corners to score" replaced the blank (`dynamic-type/006`).
- **One notation only half landed.** The Garage's theme previews still read "LEFT 4 TIGHTENS", and the plain-words example
  still says "Slow down", which is the grammar round 1 removed (`tabs/028`).

## What I'd protect

1. **The drive-ended card** (`tabs/015`): one number, one sentence, one filled primary, and two quiet exits. Don't add
   anything to it.
2. **Permission after a reason.** The location sheet comes after the welcome has shown what the app does (`first-run/008`),
   never at launch. Keep that order whatever happens to the welcome.
