# LA: Lauren Pierce, sport-touring rider (Ducati Multistrada, helmet comms, gloves)

## 1. First impressions

I opened r7 the way I'd open it in the garage with the bike on the stand: gloves on, phone in the tank bag, helmet speakers
in. The honest answer is that this app was built for someone sitting in a Toyota.

What it gets right. The call strip is the best thing here. "EASY LEFT" at that size (`guided-drive/phone/020-driving.png`)
I can read in one flick of the eyes, and the grammar round 1 built ("Careful, hairpin left, long", `transcript.txt`
02:29, 03:29) is short enough to survive a helmet. Gravel is already on the hazard sheet (`067-report-sheet.png`), which
tells me someone thought about surfaces. Ducking and `.voicePrompt` mean it talks over my Cardo's music without killing it.

What it doesn't know is that I exist. Search the repo: `MARKETING.md` says motorcyclists are "not marketed until it works on
a bike". It doesn't work on a bike. There is no vehicle setting at all. The things that decide a ride are missing:

- **Targets.** Report is about 72 x 59 pt and End about 61 x 60 pt with a 16 pt gap (`020-driving.png`). An iPhone point
  is 1/163 inch, so End is under 10 mm across. A winter glove pad is 15 to 20 mm, and the bike is vibrating. I'd hit Report
  when I meant End, or nothing at all. Undo saves the End. It does not make the button hittable.
- **Talk.** The co-driver announces its own mode changes: "Quiet from here. Bumps and cameras only." five times in the
  20-minute guided drive (`guided-drive/transcript.txt`, 04:16, 07:10, 12:36, 17:37, 19:53) and "Full notes." three more.
  In a car that is a pleasant touch. At 70 in a full-face with wind roar, every word that carries no corner is a word
  that can mask the next real one.
- **The Bank dial lies.** It reads "BANK +0.0°" in the first photo and 40 minutes later (`002-drive-started.png`,
  `020-driving.png`) beside a live Score of 612. Zero is a value. The rule in `CLAUDE.md` says unknown stays `--`. On a
  bike, lean angle is the number I'd actually look at, and it is the one thing this screen can't give me.

The big truth: Vetta's pitch is "how the road feels", and nobody feels a road more than a rider. Bike owners are the
audience that already pays for twisty-road apps (MONETIZATION lists Calimoto at about $50 to $60 a year). Vetta's
free-forever promise would beat that. But today it is a car app wearing a helmet.

## 2. Proposals

### LA-1: A Vehicle setting with a Motorcycle profile that changes how the co-driver talks
- **Why it matters.** Everything a rider needs is a parameter, not a feature, and there's nowhere to set it. Calls at
  car timing arrive late at bike speed on a twisty road. A helmet drops syllables: a missed "left" is a crash, so the
  critical call needs one repeat. Wind noise punishes long clauses, and the chained "Medium right, then tight left in 250
  feet" (`transcript.txt` 15:57) is the exact shape that gets lost. Gravel and wet leaves matter far more to two wheels.
  Evidence: no vehicle field exists in `garage_ui.js` beyond car cards; `ApexNavApp.swift` has one fixed rate
  (`utterance.rate = 0.54`).
- **What to build.**
  - A `vehicle` setting (Car / Motorcycle), asked once in Garage, not in onboarding (Dani's veto stands).
  - Motorcycle profile: call lead time scaled by speed with a longer floor (an extra 2 s over car timing); `Careful` and
    `hairpin` calls repeat once, short ("Hairpin left. Hairpin left."); chains capped at two corners and the distance
    clause dropped when under 8 s apart; speech rate about 0.50; link text reuses the car card's short variants.
  - Route defaults: Avoid unpaved on; the plan sheet's Hazards fewer/more rows hidden.
  - Hazard sheet adds Oil or diesel and Wet leaves for this profile only.
  - Drive log and Score tagged with the vehicle so a bike's numbers never mix with a car's.
- **Cost.** M.
- **Done looks like.** Switching to Motorcycle changes what `transcript.txt` says on the same replayed drive: each Careful
  call appears twice, no chain has a distance clause under 8 s, and the Log lists the vehicle.

### LA-2: Glove-sized drive controls, and Report by voice
- **Why it matters.** `020-driving.png` has the two most consequential buttons on the screen, one that records a
  hazard and one that ends the drive, both under 10 mm and 16 pt apart. The Undo from round 1 is good, but a rider
  with a mitt should never need it. And the gesture for a hazard ahead is: eyes on the road, one hand on the bar. Siri
  already ends a drive (CALL_SHEET 2026-11-02); Report has no hands-free path.
- **What to build.**
  - On the drive screen, when Vehicle is Motorcycle (or Dynamic Type is large), Report and End become at least 56 x 56
    pt each and move to opposite ends of the row (at least 120 pt apart), End still behind Undo.
  - Report opens the six-box sheet at the same minimum size, one tap with no confirm, 3-second Undo in the status row.
  - Add a Siri phrase "Report gravel / debris / pothole in Vetta" using the same intent plumbing as End. It works from
    helmet comms (the Siri button) with the phone locked.
  - The notes strip's "next" cell (small grey "EASY R", about 14 pt) rises to 18 pt on this profile.
- **Cost.** M.
- **Done looks like.** The review rig's gloved hit-test passes (a 15 mm contact disc centred on End hits only End; on
  Report only Report). "Report gravel" by voice puts the same marker on the map as the sheet's tap.

### LA-3: Bank is `--` until it's measured, and becomes Lean on a bike
- **Why it matters.** "BANK +0.0°" is shown through the whole guided drive next to a 612 Score
  (`002-drive-started.png`, `020-driving.png`), while STATE.md says the mount rotation is a hard-coded default and camber
  stays blank until calibration locks. A dial that confidently says zero on a hairpin is made-up data, against `CLAUDE.md`
  rule 3. For a rider it's worse: a phone in a tank bag or jacket pocket can't be assumed to share the car's axes, and a
  false lean number teaches me to ignore the dial.
- **What to build.**
  - The g-ball's Bank readout shows `--` (same size, same slot) whenever mount state isn't `locked` or the reading is
    null. The ball itself still draws g.
  - With Motorcycle selected, relabel it LEAN, and compute it only from a locked mount using the existing core (roll from
    gravity-aligned lateral accel and yaw rate); on `default` or `unlocked` stay `--`.
  - The replay (no IMU) shows `--` too, so the rig stops showing a false zero.
- **Cost.** S for the `--` fix; M for the lean read.
- **Done looks like.** The next recording shows `BANK --` in the replay frames, never +0.0°. A bike drive with a locked
  mount shows a signed lean that matches a known test fixture; an unlocked mount shows `--`.

### LA-4: Mode changes chime, they don't talk
- **Why it matters.** Twelve of the 28 spoken lines in the guided drive are mode announcements or the score read-out
  ("Quiet from here. Bumps and cameras only." x5, "Full notes." x3, plus the opening). That's most of the voice time on
  a quiet stretch, and the quiet stretch is when a rider listens for a real hazard. Words that cost nothing in a Buick
  cost attention in a helmet. (Margo rules on phrasing; I'm ruling on cost to the ear.)
- **What to build.**
  - Replace "Quiet from here..." and "Full notes." with two distinct short earcons (a falling and a rising two-note) on
    the Motorcycle profile, spoken only the first time per drive, with the spoken form kept for Car.
  - Everything that is a corner, hazard or camera stays spoken. The end-of-drive line stays.
  - The captions in the notes strip carry the mode name so nothing is lost visually.
- **Cost.** S.
- **Done looks like.** In a Motorcycle replay, `transcript.txt` has no "Quiet from here" or "Full notes" lines after the
  first, and the app log shows the earcon events at the same times the lines used to fall.

## 3. Did round 1 land?

Yes for what I can hear: the call grammar is shorter and warning-first (`transcript.txt` 02:29 "Careful, tight right"),
and Undo on End is real. No for riders: round 1 never asked who might be on the bike, and the End and Report targets
didn't change (`020-driving.png`).

## 4. What I'd protect

- The call strip's size and order, warning word first: it's the one part of the screen I could read through a visor.
- Gravel on the hazard sheet, with orange edges that look like what other riders will see.
