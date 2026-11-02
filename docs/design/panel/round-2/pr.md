# Priya Raman, the newcomer: round 2

Evidence: recording 7 (`scratchpad/r7`). Flow, step, photo. Where I read the code I say so.

---

## 1. First impressions

The welcome is better than it was. Six screens (`first-run/phone/002` to `007`) now say "EASY RIGHT", "TIGHT L", "OPEN L"
and "CREST", not "L4" and "R3", so the first thing I see is the same language the app will talk to me in. I can read
"Your co-driver for the long way home" and know what it means. Then the location sheet tells me why it wants me
(`008`), and the idle map gives me a place, a search box, a red Start and "Loop from here · 45 mi · On the twistiest roads
nearby" (`009`). That row is still the best sentence in the app.

Then I'm in the car, on a road that isn't mine, and the screen still talks to me in numbers I have to ask about.
`tabs/phone/005-driving.png` is the clearest case: a big "EASY LEFT" with "OPEN R" in the next cell, which is fine. But
under the map a dial says "BRAKE", a red chip says "48 Sight", another says "BANK +0.0°", and the score is "--". The
speed limit cell is a dash. A dash is honest, and I now know what it means, but I learned that by reading the code, not
from the screen. On the same drive `guided-drive/phone/003` a plate reads "85 MPH" with an eye on a road signed 70. I'd
read that as permission. I still can't tell an alarm from a reading, and that's the thing I'd need on a day off in a
car I don't know.

The planning card is good, but it's still full of words I'd have to ask about: "+7 MIN FOR FUN", "Flowing sweepers",
"Road feel after first drive" (`planning/phone/004`). I'd drive the loop. I'd also tell Dani the same thing as last time:
the map is nicer than Google, and the voice is like a passenger, but your link doesn't show me any of it.

---

## 2. Proposals

### PR-1: Explain Sight, Score and Bank before the first drive, behind one tap on each

- **Why it matters.** This is still the one thing on the drive screen I'd act on wrongly. "Sight 48" in red,
  `tabs/phone/005`, and the eye plate "50 MPH" (`guided-drive/phone/003`), are numbers that aren't targets, and nothing
  on screen says so. Round 1 put this at rank 7 and Dani vetoed a whole screen. The vote asked whether to explain behind a
  tap. Yes: a tap, not a screen. Nothing in the web folder explains Sight, Bank or the eye to a user (`garage_settings.js`,
  `whats_new.js`, `about.html`); the owner's definition is only in a code comment (`instruments.js:336`).
- **What to build.** Keep the "Before your first drive" sheet (`index.html` `permSheet`) as it is. Add one line of help
  to each instrument the first time it's seen on the drive screen: a small "i" on the Sight cell, the Score dial and the
  Bank dial. Tapping it opens one sheet with three rows drawn by the real renderers from `instruments.js`. Sight: "The
  fastest you could stop from, given what you can see. Red means you're over it. It is never a target." Score: "-- until
  the drive ends. It's about smoothness, not speed." Bank: "How much the road leans. Nothing to do; just interesting."
  The same sheet is under Garage > Co-driver > How this works. The "i" goes away after the first drive; the sheet
  stays. No new screen before Start.
- **Cost:** M.
- **Done looks like:** `tabs/phone/005` has a small "i" on Sight; a photo of the opened sheet shows three rows with the
  real cell next to each sentence; `guided-drive/phone/003` looks the same as today.

### PR-2: The drive screen gets an alarm grammar, one meaning per colour

- **Why it matters.** I spent twelve-hour shifts reading monitors. The rule there is that a red thing means act now and
  a thing that is only a reading never looks like an alarm. On the drive screen, red is the route line, the record dot,
  the Sight chip, the BANK readout, the eye plate and the hazard. In `tabs/phone/005` "BANK +0.0°" is red for a value of
  zero. A newcomer can't tell whether that's a warning. Alarm fatigue is how monitors stop being trusted, and it is the
  same here: once one red number is noise, I stop reading the red ones.
- **What to build.** Red is reserved for "act now" (a call with a warning word, an over-Sight speed, a hazard). Readings
  (Bank, Score, Sight when under) go to the ink colour already used for the odometer. The eye plate keeps its eye but
  shows its unit and source on the same line ("LIMIT 70 · SIGN" when it's the posted limit, "SIGHT 85" when it's the
  Sight cap), so 85 cannot read as a limit. Where there's no data the cell says "--" with a grey label, as the Speed Limit
  cell does now, and it is never blank. A test (`tabs/phone/005` and `guided-drive/phone/003`) checks that red appears on
  a single class of element per frame in a default-settings recording.
- **Cost:** M.
- **Done looks like:** `tabs/phone/005` has red only on the "EASY LEFT" call and nothing else when the car is under Sight;
  `guided-drive/phone/003` shows "SIGHT 85 · LIMIT 70" in ink, not a red plate with an eye.

### PR-3: Signed out, People shows me one real crew before it asks for my Apple ID

- **Why it matters.** Signed out, People is still a glyph, "Find or start a crew · 1 crew near you", and a dimmed
  example card with "Your crew" in grey (`signed-in/phone/003`, the Crews side I see before the sign-in buttons). The
  one-crew count is real; the card isn't. The first-run rule for a link (round 1, P-1) puts the welcome first, which is
  now built, so the next thing I meet is this empty side. I'd sign in for Dani's crew. I would not sign in for "Your crew".
- **What to build.** Extend `/api/crews/invite/preview` with what a crew chooses to make public: name, member count,
  sender, cover photo, next drive's day and road. Signed out, when `apex.crew` is stashed, render the real crew header
  (`web/crew_page.js`) with "Join [crew name]" as the only key and "Sign in with Apple / Google" as the line under it.
  With no link, the signed-out Crews side shows one real nearby crew's public header instead of the grey example, and the
  Friends side keeps its dimmed example row under a small map thumbnail with a dimmed pin on my real area, captioned
  "Example". Server flag: a public-fields setting on the crew, default off.
- **Cost:** M.
- **Done looks like:** a "crew-link" flow in the next pack: photo 1 is the welcome with the crew's name, photo 2 is the
  signed-out Crews side with the real card and one Join key, photo 3 is the idle map with "Join [crew]" in the suggestion
  row.

### PR-4: Route card in my words, and the Garage opens on me

- **Why it matters.** `planning/phone/004` is still the screen I'd trust most and it still has four words I'd have to
  ask about: "+7 MIN FOR FUN", "Flowing sweepers at 2.1, 4.0 and 6.3 mi", the TWIST 56 and FLOW 23 dials with no scale,
  and "Road feel after first drive". The alternatives say "Fun 45 · 23 min" and "Fun 37 · 16 min", so "Fun" is both a
  mode and a number (`planning/phone/005`). In the Garage (`signed-in/phone/004` to `006`), I'm two screens into a free
  app before I see anything about me; three "PRO" cards with sample lines come before "Co-driver" (`006`), and the words
  setting is on the seventh screen (`007`).
- **What to build.** Copy only, in `web/drive_card.js` and the route card builder: "+7 MIN FOR FUN" becomes "+7 min, the
  long way". In plain-words mode "Flowing sweepers" becomes "Long, open bends" (`web/apex_core.js:1092` and
  `web/road_page.js:76`; rally mode keeps "sweepers"). The Twist and Flow dials get "/100" and a caption the first time
  they show. "Road feel after first drive" becomes "Surface and cameras: known after someone drives it with Vetta". The
  alternative tiles say "This one · 23 min" and "Straighter · 16 min, 7 min quicker". In `cockpit.js`, the Garage order
  becomes You, Your cars, Co-driver, The words, then one row "Look and voice >" that opens the three PRO cards as a sheet.
- **Cost:** S.
- **Done looks like:** `planning/phone/004` has no word a non-driver would ask about; `signed-in/phone/004` shows You,
  Your cars, Co-driver on one screen with a single "Look and voice" row; the theme cards appear only in a photo of the
  opened sheet.

---

## 3. Did round 1 land?

- **P-1 (crew link opens the welcome first): landed in code** (`web/cockpit.js:6596` to `6599`: the welcome runs and says
  "A crew link is waiting. It opens after Start."). Not yet in a photo, because the crew-link flow isn't in recording 7.
  The crew's name is still missing, as the call sheet said.
- **P-2 (one language): mostly landed.** The welcome now shows plain calls (`first-run/phone/002` to `007`), and the
  driving next cell reads "OPEN R" (`tabs/phone/005`). The route card and the Garage quote still use "sweepers" and
  "tightens" in some places (`planning/phone/004`, `signed-in/phone/005`).
- **P-3 (explain the dash): not built,** as voted. Still the biggest gap on the drive screen.
- **P-5, P-6 (route card copy, Garage order): not built.** They were not in round 1's winners; this is the first time
  they're on the table.

---

## 4. What I'd protect

1. **The idle map and its one suggestion.** `first-run/phone/009`: the place plate ("Colerain Township · Dry · 57°"),
   one search field, one red Start, and "Loop from here · 45 mi · On the twistiest roads nearby". Don't add a row.
2. **The location sheet and the Garage's privacy line.** "Required for live turn-by-turn navigation and road-feel
   mapping" (`first-run/phone/008`) and "Nobody sees where you are" (`signed-in/phone/004`). Keep them this blunt.
