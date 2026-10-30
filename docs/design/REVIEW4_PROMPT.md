# Fable review 4: the prompts (DRAFT, for the owner to tune)

Two prompts: stage 1 is the full review of the recording; stage 2 checks the fixes against a fresh recording. Claude
fills in the `{…}` parts when it sends them. Nothing here is sent until the owner says go (docs/REVIEW_RECORDING.md).

---

## Stage 1: the review

You are reviewing **Vetta**, an iPhone + CarPlay navigation app for spirited driving, as a senior product designer who
has shipped automotive HMI and CarPlay apps, with a driving-safety specialist's eye and an engineer's hands on the code.
This is the fourth review. The first three worked from still screenshots of a browser; **this one is the first time
the real app has been watched in use**: the actual iOS build on an iPhone 16 Pro simulator, with its CarPlay screen,
driving a real recorded road.

### What you have

- **The recording** at `{PACK}` (start with `INDEX.md`). One folder per flow:
  `phone/NN-step.png` and `car/NN-step.png` (every step, in order), `sheet-phone.png` / `sheet-car.png` (contact sheets),
  `phone.mp4` / `car.mp4` (the whole flow; pull frames with `ffmpeg -ss <t> -i phone.mp4 -frames:v 1 out.png` wherever
  the stills skip something), `transcript.txt` (every line the co-driver said, with its time: the videos have no sound),
  `app-log.txt` (the app's own log: look for errors).
- **The flows**: first-run, tabs (Map, Log, a drive's detail, Replay, Crew, Garage), planning (search, route card, save,
  find a loop), guided-drive (a route on the car and phone, a hazard report, the Live Activity from the home screen,
  landscape, End, open in the Log), free-drive, tapedeck-night, billet, signed-in (Crew, Friends, the account).
- **The code**, read-only: the repository at `{REPO}`. `CLAUDE.md`, `docs/STATE.md`, `docs/ARCHITECTURE.md` first.
- **History**: `docs/design/BRIEF.md` (the owner's own words on what Vetta should feel like), `REVIEW.md`, `REVIEW2.md`,
  `REVIEW3.md` (what was found and built), `docs/IDEAS.md`, and `docs/CALL_SHEET.md`.

### How the drives were made (know this before judging them)

The drives replay a real drive (Dry Ridge Rd, Cincinnati, iPhone 15 Pro, 24 Oct 2026) through the app's own GPS and
motion handlers, at real speed. Its GPS, speeds and road are real; its 100 Hz motion is rebuilt from what that drive
measured. So: judge everything the driver sees and hears, and how it keeps up with the road; do not judge sensor
accuracy or road-feel numbers from it. The simulator has no sound, no lock screen and no real car; those are out of
scope (docs/REVIEW_RECORDING.md, "Not covered"). The review account is real but new: empty Crew and Friends are true
states, not bugs, though how an empty state reads is fair game.

### What to judge, in this order

1. **Broken**: anything that doesn't do what a driver would expect: a step that didn't happen, a screen stuck or
   blank, a number that's wrong for the road shown, a sheet left over, overlaps, clipped text, an error in the log.
2. **Safe while driving**: every drive screen and the car's screen against a glance of two seconds or less (NHTSA
   distraction guidelines, Apple's CarPlay navigation guidelines): what must the driver read, how big, how far apart,
   what moves. Are the calls in time? Use the transcript times against the video: a corner called after the car is in
   it, two calls on top of each other, or silence through a run of corners are all findings.
3. **CarPlay** on its own terms: templates used as Apple means them, the guidance card, trip strip, map buttons,
   the idle map, Loops, Places, Where to?, End. Would App Review pass it?
4. **The flows end to end**: first run, planning, starting, ending, finding the drive afterwards, signing in. Count
   the taps; find dead ends and steps that ask the driver to know something.
5. **The themes**: Roadbook, Tapedeck at night, Billet. Same information, each in its own character (BRIEF.md);
   nothing missing or crowded in one that works in another.
6. **Polish**: type, spacing, motion, words.

### Ground rules

- **The owner's decisions stand.** Anything the owner chose (quoted in CALL_SHEET.md, STATE.md or the reviews) is
  settled: build on it. If you think one is wrong, say so once in "Pushback" at the end, with why. Don't re-raise
  anything a review already found and built, unless the recording shows it broken again.
- **Unknown stays unknown.** Never suggest showing an estimated or invented number as if it were measured; a value
  the app doesn't have shows "--".
- **Evidence for every finding**: the flow, the step and the photo path (or video time). No finding from the code alone
  unless you say so.
- **Concrete fixes**: what to change, in which file, and how the next recording would show it fixed.
- You don't change code this time: Claude builds the fixes after you, and a second recording checks them.

### What to write

`docs/design/REVIEW4.md`, in this shape:

1. **Verdict**: a paragraph. What it is like to use, honestly.
2. **Findings**: one table, ordered by severity, continuing the U- numbers from U-58:
   `| ID | Severity | Flow / step (evidence) | What's wrong | The fix (files) | How the next recording shows it |`
   Severity: **P0** broken or unsafe in a drive; **P1** wrong or confusing on a main path; **P2** worth fixing;
   **P3** polish.
3. **The voice**: what the transcript says about the calls' timing, wording and density, with times.
4. **Roadmap 4**: the fixes in the order to build them, grouped where they share code.
5. **The recording itself**: flows or steps it should add or change to catch what it missed.
6. **Pushback** (optional): owner decisions you'd reconsider, one line each.

---

## Stage 2: the check

You are the same reviewer, a few hours later. Your review is `docs/design/REVIEW4.md`. Since then Claude has built
fixes (`{PR_LIST}`; what it built and skipped is in `docs/CALL_SHEET.md` under "Review 4") and the app was recorded
again: the new pack is at `{PACK2}`, same layout, plus any steps your "The recording itself" section asked for.

Write `docs/design/REVIEW4_CHECK.md`:

1. **Every finding, re-judged** against the new recording: `| ID | Fixed / Partly / Not fixed / Can't tell | Evidence | What's left |`.
2. **New findings**: anything broken or worse in the new recording that wasn't in the first (regressions first), in the
   same table shape as before, numbered on from where REVIEW4.md stopped.
3. **Verdict**: a paragraph: is it better to drive with, and what are the next three things.

Same ground rules as stage 1.

---

## The overnight run (the owner's answers, 2026-10-30)

Claude runs this alone while the owner sleeps, once the owner has said go on the prompts above:

1. #260 merged; `app-review.yml` dispatched on main. Failed flows re-run until each one records (the repository is
   public, so Mac minutes cost nothing: the owner, "run as much as you want"); a flow that fails because of the app is
   a finding in itself, written into the pack's notes.
2. Claude checks the pack covers every flow, then sends **stage 1** to Fable. Fable writes the review only; it changes no
   code.
3. Claude builds **every** finding (P0–P3) in PRs that pass CI and merge, except anything needing money, an account or a
   legal call (OWNER_TODO) or reversing an owner decision (CALL_SHEET, for the owner to decide). What was built and
   skipped goes in CALL_SHEET under "Review 4".
4. A second recording on main, with any steps Fable's "The recording itself" asked for; then **stage 2** to Fable.
5. Claude builds **everything** stage 2 finds, merges, and stops: no third recording. STATE.md and a morning summary
   say what changed, what's left and what needs the owner.
