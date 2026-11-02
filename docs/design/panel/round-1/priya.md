# Priya Raman, the newcomer: round 1

Who I am: 29, a nurse, three twelve-hour shifts a week and then a day off that I like to spend driving somewhere green in
my CR-V with a coffee and a podcast. I am not a car person. I don't know what a hairpin is called, I have never heard a
rally pace note, and I have no opinion about tyres. My friend Dani sent me a crew link on Saturday night: "download this,
join our crew, you'll like the roads". That link is the whole reason I'm here.

Evidence: recording 6 (`scratchpad/r6`). Flow, step, photo. Where I read the code to find out why something happened,
I say so.

---

## 1. First impressions

Dani's link didn't do what she said it would. I read the code to be sure (`web/cockpit.js:6319`): when the app is opened by
a crew link it skips the welcome screen entirely and marks me "onboarded", then drops me on the People tab, signed out,
looking at a shield icon, three little glyphs, "You have a crew link. Sign in to see which crew, then join it." and two
sign-in buttons. I haven't seen a map. I haven't seen a road. I don't know what the app does. And its first ask is my
Apple ID. For an app that was built to be "intuitive enough for a new user to pick up and use every basic function", the
route most new users will actually arrive by (someone sent me a link) is the one route where the app never introduces
itself. I would have signed in anyway, because Dani asked, but I'd be doing it on faith, not on anything the app showed me.

So I deleted my data and opened it clean, the way the recording does (`first-run/phone/001-opening.png`). That is a lovely
screen. Cream paper, a big friendly sentence, "Calls every corner before you reach it", and a red Start. I understood the
promise in a second. What I did not understand was the thing under it: "RIGHT 5 · LONG", then "300 ft · L4", "RIGHT 3",
"CREST", "LEFT 4 · TIGHTENS", "R5", "L2" (`001` to `007`). Right five what? Is five bad? Is two worse? The app's own default,
which I found later in the Garage, is "Plain words" ("Medium left, tightens, slow down", `signed-in/phone/007-account-3.png`).
The welcome shows me the other language. It's like a hospital leaflet in Latin on the cover and English inside.

Then it got good. The location sheet says why it wants me (`008`). The map is calm and pretty and tells me where I am and
that it's 59 degrees (`009`). "Loop from here · 45 mi · On the twistiest roads nearby" is exactly the sentence I wanted
somebody to say to me on a day off. I typed a park, picked it, and got a card with 9.0 mi, 23 min, "+7 MIN FOR FUN", a
hill picture, and "Forecast along the way: no rain, ice or fog" (`planning/phone/004`). I'd drive that. Then I'd be in the
car, and that's where I'd get scared: "EASY LEFT", fine, but "R4" in the corner; a plate under my car that says
"85 MPH" with an eye on it on a road signed 70 (`guided-drive/phone/003-interstate.png`); "Sight 69", "BANK +0.0°",
"BRAKE", "SCORE --", "Calibrating · drive normally". Nothing on the screen tells me which of those is a speed I should be
doing, which is a warning, and which I can ignore. A nurse reads a monitor the same way a driver reads a dash: if I can't
tell the alarm from the vitals, I stop trusting the monitor.

What I'd tell Dani: "The map part is nicer than Google and the voice is like having you in the passenger seat. But I had
to ask you what half the dashboard meant, and your link didn't show me any of the nice bits." I'd come back for the loop
and the voice. I would not open People again unless she made me.

---

## 2. Proposals

### P-1: A crew link opens the welcome first, then the crew

- **Why it matters.** My way in is the link. `web/cockpit.js:6319` skips `runOnboarding()` whenever the URL has `crew`,
  `invite` or `add`, and `6320` marks me onboarded without ever having seen the welcome. I land on the signed-out Crews
  side (`signed-in/phone/003-crews.png` is the member version; the signed-out one is built at `cockpit.js:4084-4094`):
  a logo, three glyphs, "Drive as a crew", and two sign-in buttons. The one screen that explains the product
  (`first-run/phone/001`) is the one screen a linked newcomer never sees. The REVIEW.md bar says sign-in happens "at the
  first social action", after the user has seen a map; a link today puts it before the map.
- **What to build.** In `cockpit.js` first-run: when `crew`/`invite`/`add` is present and `apex.onboarded` is unset, run
  the welcome with one extra line under the tagline, "Dani's crew, Ridge Runners, is waiting for you" (from
  `/api/crews/invite/preview`, name and sender; fall back to "A crew link is waiting"), and the key reads "Start" as now.
  Start closes the welcome, asks location, lands on the idle map, and the People tab shows its badge (the P-34 badge at
  `cockpit.js:4150` only runs signed in; show it signed out too when `apex.crew` is stashed). A second, quieter line on
  the idle map's deck for that session: "Join Ridge Runners" as the suggestion row's text link beside "Plan". Tapping it
  opens People > Crews, which already handles the join (`4123-4145`). Nothing about the sign-in itself changes.
- **Cost:** S.
- **Done looks like:** a flow "crew-link" in the next pack: open with `?crew=`, photo 1 is the welcome with the crew's
  name on it, photo 3 is the idle map with a People badge and "Join Ridge Runners" in the deck, photo 4 is the join card.

### P-2: One language, and it's the one I speak: the welcome and the strip use Plain words by default

- **Why it matters.** The default is Plain words (`signed-in/phone/007-account-3.png`, "Medium left, tightens, slow down").
  But the welcome's demo strip is hard-coded to rally calls (`OB_NOTES` at `cockpit.js:6277-6284`: "Left 4 tightens",
  "Right 3", codes `L4`, `R3`, `R5`) (`first-run/phone/001` to `007`). And while driving, the head cell says "EASY LEFT" in
  words but the next cell says "R4" (`tabs/phone/005-driving.png`) and "LAC" (`guided-drive/phone/003`). The theme cards
  in the Garage quote "Open left, tightens. Watch the exit, it closes" (`signed-in/phone/005`), which is better, but the
  Hear key plays rally words (`cockpit.js:1280`, "the voice bank's clips are rally words"). I'm shown three vocabularies
  before my first drive. The app has already decided new users get plain words; it should look like it decided.
- **What to build.** (a) `OB_NOTES`: add a `plain` field per note ("Medium left, tightens", "Easy right", "Crest", "Open
  left", "Tight right, long") and have `runOnboarding()` render it when `words` is plain, with the next cell's code
  replaced by a short plain token: "EASY R", "TIGHT L", "CREST" (a second table in `stripCode()` keyed by the plain mode).
  (b) Same `stripCode()` change serves the live strip's next cells. (c) The Garage's "The words" row moves up to sit
  directly under Look and voice with a one-line sample of each mode that updates the theme card's quote. Rally notes
  stay exactly as they are for the people who want them; this is only what the default shows.
- **Cost:** S.
- **Done looks like:** `first-run/phone/001` reads "250 ft · TIGHT RIGHT · LONG | 300 ft · EASY L"; `tabs/phone/005`
  reads "EASY LEFT | 950 ft · TIGHT R"; no `L4`, `R3`, `LHP` or `LAC` anywhere in a default-settings recording.

### P-3: The dash says what each number is for, once, before my first drive

- **Why it matters.** My first drive shows me, with no introduction: a plate under the car reading "85 MPH" with an eye
  on it while the Speed Limit sign reads 70 (`guided-drive/phone/003`); "Sight 69" in red; "BANK +0.0°"; a dial labelled
  "BRAKE"; "SCORE --"; "Calibrating · drive normally"; "Mount set" (`tabs/phone/002`, `003`). I searched the whole web
  folder: no screen, sheet or "How this works" explains Sight, Bank or the eye plate to a user (nothing in
  `garage_settings.js`, `whats_new.js` or `about.html`). The owner's definition is in a code comment
  (`instruments.js:336`: "the speed you could stop from within what you can see ahead"). To me "85 MPH" with an eye next
  to it reads as "you could do 85 here". That is the opposite of what it means, and it is the one thing on this screen I
  would have acted on. The "Before your first drive" sheet (`index.html` `permSheet`) is already the right moment and the
  right tone (Location "to call corners ahead", Motion "to feel bumps and surface").
- **What to build.** Extend `permSheet` with a second page, "What you'll see", shown once: three rows drawn with the real
  instrument renderers from `instruments.js` so they look like what I'm about to see. Sight: the eye plate and the cell,
  "Sight: the fastest you could stop from, given what you can see. Red means you're over it. It is never a target."
  Score: "-- until the drive ends. It's about smoothness, not speed." Bank: "How much the road leans. Nothing to do; just
  interesting." A "Show again" row under Garage > Co-driver > How this works opens the same sheet. On the drive screen
  itself, rename the plate's eye to "SEE" text on small widths only if the eye tests as unclear; I'd rather keep the eye
  and explain it than change the instrument.
- **Cost:** M.
- **Done looks like:** the first-run flow has a photo between the location sheet and the idle map's first Start where
  "Sight", "Score" and "Bank" each have one sentence beside the thing they label; the guided-drive's `003` looks the same
  as today, because the screen didn't change, I did.

### P-4: People shows me what I came for, signed out

- **Why it matters.** Signed in with no friends, the Friends side is one sentence, one key and a dimmed "EXAMPLE" row
  (`signed-in/phone/001`), and the Crews side is one sentence and a dimmed example (`003`). Signed out, which is how I
  meet it (code at `cockpit.js:4084-4094`), it's a logo, three glyph labels, and sign-in buttons. The idle map has a Friends
  switch in Layers (`first-run/phone/010`) with nothing behind it. The REVIEW5 verdict was right ("telling a new member
  nothing about what a friend on this map looks like"); the example rows were the fix, and they are honest, but they are
  a caption, not a picture. I want to see Dani's crew before I give anyone my Apple ID.
- **What to build.** A crew's invite preview (`/api/crews/invite/preview`) already returns name, member count and sender.
  Extend it with what the crew chooses to make public: cover photo, motto, next drive's day and road, member count. The
  signed-out Crews side with `apex.crew` stashed renders the real crew card, exactly as a member sees its header
  (`web/crew_page.js`), with "Join Ridge Runners" as the only key and "Sign in with Apple / Google" as the step under it.
  Without a link, the signed-out side shows one real nearby crew's public header ("1 crew near you" already exists on
  `003`) instead of the glyphs. The Friends side signed-out keeps the dimmed example row (it's fine) under a map thumbnail
  with one dimmed friend pin on the user's real area, captioned "Example", so "Who's out driving" is a picture of the map
  they just saw.
- **Cost:** M (server: a public-fields flag on the crew and the preview; client: reuse the crew header).
- **Done looks like:** the "crew-link" flow's join photo is the Ridge Runners card with a cover photo, "Next drive: Sunday
  7 a.m. · Dry Ridge Rd", "4 members · @dani sent you the link", and one Join key.

### P-5: The route card tells me what I'm agreeing to, in my words

- **Why it matters.** `planning/phone/004-route-card.png` is the best screen for me and still has four things I can't
  read: "+7 MIN FOR FUN" (fun for whom? it means the app is taking me the long way on purpose, which I'd like to be told
  plainly), "Ahead: Flowing sweepers at 2.1, 4.0 and 6.3 mi" (I don't know what a sweeper is), "TWIST 56" and "FLOW 23"
  (56 of what? is 23 low? the half-dials give no scale), and "Road feel after first drive" (whose first drive?). The
  alternatives say "Fun 45 · 23 min · this one" and "Fun 37 · 16 min · 7 min quicker" (`005`), so "Fun" is now a number
  as well as a route mode. On the Roads switch, "Quick / Fun / Max fun" was the one row I understood.
- **What to build.** Copy only, in `web/drive_card.js` / the route card builder: "+7 MIN FOR FUN" becomes "+7 min, the
  long way"; "Flowing sweepers" becomes "Long, open bends" in plain-words mode (rally mode keeps "sweepers"); the Twist
  and Flow dials get a tiny "/100" after the number and a one-line caption that says what they are on first show
  ("Twist: how many corners per mile. Flow: how well they link up."), collapsed after the first route; "Road feel after
  first drive" becomes "Surface and cameras: known after someone drives it with Vetta". The alternative tiles drop the
  word "Fun" and say "This one · 23 min" and "Straighter · 16 min, 7 min quicker".
- **Cost:** S.
- **Done looks like:** `planning/phone/004` with no word on it a non-driver would have to ask about; "sweepers" only
  appears in a Rally-notes recording.

### P-6: The Garage's first screen is me and my car, not a theme catalogue

- **Why it matters.** As a signed-in newcomer, Garage opens with "You", an initial in a circle, "Add a photo", a privacy
  line, "Who sees what: Nobody sees where you are" (good), "Your cars: Add a car", and then, taking the rest of the first
  screen and the whole second, three theme cards with "PRO" tags and "Use" keys (`signed-in/phone/004`, `005`, `006`).
  I'm two minutes into an app that said it was free forever and the first thing I'm scrolling past is a paid upsell
  with sample lines in a vocabulary I don't use. The owner's plan says the theme picker is "the only place Pro is sold
  inside the app"; fine, but it needn't be the first thing in the Garage.
- **What to build.** In `cockpit.js` Garage render order: You (with photo and Who sees what), Your cars, Co-driver
  (Notes, Voice, Haptics, Key sounds, Night) and The words, then one row "Look and voice · Roadbook · Marguerite >" that
  opens the three cards as a sheet (`garage_settings.js` already does bottom sheets for ten rows; this is an eleventh).
  The "PRO" tag stays on the cards inside the sheet. Nothing else moves.
- **Cost:** S.
- **Done looks like:** `signed-in/phone/004` shows You, Your cars and Co-driver on one screen with a single "Look and
  voice" row at the bottom; the theme cards appear only in a photo of the opened sheet.

---

## 3. What I'd protect

1. **The idle map and its one suggestion.** `first-run/phone/009-idle-map.png`: the place plate ("Colerain Township · Dry ·
   59°"), one search field, one red Start, and "Loop from here · 45 mi · On the twistiest roads nearby". I understood the
   whole product from that one row. Don't add to it.
2. **The location sheet and the Garage's privacy line.** "Required for live turn-by-turn navigation and road-feel
   mapping" (`008`), "Nobody sees where you are" (`signed-in/phone/004`), "Photos lose their location data before they
   leave your phone". These are the sentences that made me willing to sign in at all. Keep them exactly this blunt.
3. **The end card.** `tabs/phone/014-drive-ended.png`: the road's name, "1.4 mi · 2 min · 3 corners", 788/1000, and one
   sentence I could actually act on ("Braking finished by the middle of each corner, and nothing stands out to fix"). It
   is the first time the app told me how I did in words I understood, and it's kind without being cute.
