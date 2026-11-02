# Ray Castellanos, the product skeptic: round 1

Evidence is recording 6 (`scratchpad/r6`), paths relative to the pack; `free-drive/phone.mp4 @ 05:12` is a frame I pulled.
Where I read code to name a cause I say so. Free forever is the promise, so nothing below is about money.

## First impressions

I have grown two consumer apps and killed three, and the three I killed all died the same way: people loved the thing it
did and never came back to do it again. So the first question I ask of any app is not "is it good" but "what, on a
Tuesday, makes someone open it on Sunday." I drove Vetta five times across these flows and the drive is the real thing.
"Tight right, careful" 850 feet out, quiet on the straight and saying so, a sign-off with a number
(`billet/transcript.txt`, `tabs/transcript.txt` 19:41:13). The end card is a moment (`tabs/phone/014-drive-ended.png`).
If a friend asked, I would say: install it, drive one twisty road, you will grin.

Then I would say the harder thing. Nothing in this app ever calls you back. There is no notification of any kind, by
design so far (IDEAS C-06: "the app sends no notifications yet"), and the crew drive's "morning reminder" is drawn in the
cockpit only if you already opened the app (`web/crew_events.js:38`, read in code). The one invitation on the idle map,
"Loop from here · 45 mi · On the twistiest roads nearby", is the same sentence in Colerain Township on first run, in
Harrison Township after a drive, and after the car drive (`first-run/phone/009`, `tabs/phone/001`,
`free-drive/phone/021`); it is the dial's detent printed as a title (`web/cockpit.js:4765`), not a suggestion. The
share card is a picture with no way back in (`web/drive_card.js`; `web/cockpit.js:4027` admits links "open the website"
because nobody else can open `apexnav://`). The product's retention loop today is: the driver remembers it exists.

Is it one product or several? Two. A world-class solo co-driver, and a social scaffold built very deep for nobody yet.
The scaffold has crews with livery tiers, call signs, crew hazard categories, member badges, a house stage, 30-day chat,
kudos, flyby, local legends, standings, builds (`web/crew_page.js`, `web/builds.js`, `web/legends.js`, `web/flyby.js`).
In the recording the account has zero friends, zero crews, and People shows a greyed "Example" of each
(`signed-in/phone/001`, `003`). I am not against the scaffold; most of it is correctly hidden until it has data. I am
against not knowing whether any of it works, because this round's recording never once shows a crew page, a crew drive,
a board or a chat with a person in it, and the tabs flow's Log, People and Garage steps all photographed the replay
(`tabs/phone/020-log.png` through `036-garage-8.png` are every one "Replay finished · 788"). The Log index with a real
drive in it has not been seen this round.

The honest summary: the drive is the product, the week between drives is empty, and the social half is unreviewable
until the rig gives it people.

## Proposals

### R-1: The Sunday hook: a real suggestion on the map and one opt-in nudge the evening before
- **Why.** Retention is the only metric a free-forever app has, and today the app has no mechanism for it at all. The
  idle plate is a constant string (`first-run/phone/009`, `tabs/phone/001`, `free-drive/phone/021`: same words, three
  places, two days; `web/cockpit.js:4765`). The crew drive's reminder is in-app only (`web/crew_events.js:38`). No
  notification permission is ever asked (IDEAS C-06). Everything the app needs to make a real suggestion already exists:
  Explore finds the best stages within N minutes (R-10), the forecast is per route (R-21), the Log knows your best road
  and your last score, crew events know Sunday's drive.
- **Build.** (a) The map's plate becomes a decision, not a label: one line chosen in this order: your crew's next drive
  if within 7 days ("Sunday 9 AM · Dry Ridge Rd with Ridge Runners · Going"); else the best road within 30 minutes you
  have not driven, with the day's forecast ("Dry today · Carolina Trace Rd, 18 min away · 34 corners"); else the road you
  scored best on ("Back to Dry Ridge Rd · 788 last time"); else today's "Loop from here". Same plate, same size, one tap
  routes it (`web/place_plate.js` / `cockpit.js` loopSuggest; data from `stages.js`, `route_weather.js`, `road_votes.js`,
  `crew_events.js`). (b) One local notification, off by default, one switch in Garage > gear ("Remind me the evening
  before a drive I said I'm going to"); a second line of the same switch for "Saturday evening if Sunday looks dry near a
  good road", at most one a week. Native `UNUserNotificationCenter` through the shell bridge, scheduled from the page;
  tapping opens the plate's suggestion. No streaks, no "you haven't driven in 9 days", nothing unprompted: the "Not
  doing" list holds. Update `docs/APP_REVIEW.md` (notification permission copy, 5.1.1).
- **Cost.** M.
- **Done looks like.** Three idle-map photos in the pack with three different plates, each naming a road and a reason;
  a Garage gear sheet with the switch off; a photo of the notification on the lock screen in the signed-in flow.

### R-2: The share card lands somewhere: a link to the road, not a dead picture
- **Why.** "What's missing that would make people show each other" is the question, and the answer is that they can,
  but it goes nowhere. Share card (`tabs/phone/014`) exports a 1080x1350 PNG (`web/drive_card.js:7`) with no URL. The
  route's Share sends a shape to friends already in the app (S-05). An invite link is a website link that offers to open
  the app (`web/cockpit.js:6332`), which is right, but the card, the thing people actually post, is the one object with
  no link on it. A friend sees "788 · Carolina Trace Road" in a group chat and has nothing to tap.
- **Build.** The share sheet gets the image and a URL together (`shareFile` bridge already carries files; add `text`).
  The URL is a road page on the website (`web/road_page.js` already renders archetype, corners, confidence; give it a
  route `web/about.html?road=…` or `/r/<stage id>` path) showing the road only, never the drive, with "Drive it in
  Vetta" that deep-links `apexnav://open?road=` when the app is installed and the App Store listing when it is not. The
  card itself prints the short URL on its bottom rule. Universal Links need the owner's domain (OWNER_TODO); the page
  and the printed link do not.
- **Cost.** M (S if the road page already accepts an id).
- **Done looks like.** The share-sheet photo in the tabs flow shows an image and a link; a browser capture of the road
  page with the Drive-it key; `drive_card.js`'s canvas has the URL on its last line.

### R-3: The Log is a list of drives again: ten panels to four
- **Why.** The owner's complaint was "a list of capabilities with boring buttons". The cockpit fixed it; the Log grew it
  back. `web/analysis.html:290` to `:308` stacks a hero, a summary row, challenges, Your week, Your roads, Kudos for you,
  Friends lately, Score over time, Your records and Braking consistency by month, then the drives. Most are hidden until
  data exists, so a new user sees a short page and a six-month user sees a dashboard they did not ask for. The Stages
  side opens on a form, "New stage from a drive", with a drive picker and a two-sentence instruction
  (`dynamic-type/phone/009-log.png`), which is the exact pattern REVIEW.md 1.2 removed from the old Stages tab.
- **Build.** Log keeps: hero, the one summary row, the drive list, Drives/Stages. Score over time, Your records, Braking
  consistency, Your roads collapse into one `Trends` row that opens a page. Friends lately and Kudos for you move to
  People > Friends (they are about friends; `analysis.html:303`, `:304`). Stages empty state is one line and the
  "your drives" link; the form exists only behind a drive's Mark a stage. Challenges stay one line.
- **Cost.** S.
- **Done looks like.** `tabs/phone/020-log.png` is the Log with one drive row and nothing under the summary line but the
  list; the Stages side shows one sentence; People > Friends carries "Friends lately".

### R-4: Record the social half with people in it, and fix the tabs flow
- **Why.** I cannot vote on crews, boards, convoys or chat from this pack because none of them appears with a person.
  People is two "Example" figures (`signed-in/phone/001`, `003`; `web/people_samples.js`). The crew page, the drive card
  in its four states (`web/crew_events.js:1`), the board, chat, Decals: never photographed. And the tabs flow's Log, People
  and Garage steps are seventeen photographs of the replay (`tabs/phone/020` to `036`), because `closeReplay()` in
  `UITests/ReviewFlows.swift:318` did not close it and the tab bar is hidden under a replay, so every `tab()` fell on the
  map. The next panel will be blind the same way unless the rig changes.
- **Build.** (a) A review world served by a stubbed Worker when `APEX_REVIEW=1` (as `e2e/smoke.js` stubs it): two
  friends, one crew of four with a drive planned for Sunday and one remembered drive, a board with three scores, four
  chat lines. Held like the scores POST so nothing is written anywhere (REVIEW4's "recording never writes real data"
  rule). (b) A tenth flow, `crew`: People > Crews > the crew page, scroll; the drive card; Plan a drive; the board's
  Week/Month switch; chat. (c) `test02Tabs` asserts the replay's Done key before `tab("Log")` and fails loudly if the
  tab bar is not visible, so a stuck step is a red run, not seventeen photos of the same screen.
- **Cost.** M.
- **Done looks like.** `INDEX.md` lists a `crew` flow; `tabs/phone/020-log.png` is the Log; the crew page appears with
  four members and a Sunday drive, so the next round can judge whether a crew does anything together.

### R-5: After a drive, the map comes back whole
- **Why.** The after-drive moment is when a driver decides what to do next, and twice in this pack the app does not
  return to its idle state. After the car-started free drive ends, the Where to? field and the Start key are gone: only
  the loop plate and the tab bar remain (`free-drive/phone/021-after.png`; still gone at `free-drive/phone.mp4 @ 05:12`,
  sixteen seconds after "replay parked"). Compare `first-run/phone/009-idle-map.png`. In code `#app.live .plan { display:
  none }` (`web/index.html:298`), so the `live` class outlived the drive, most likely because the car scene still counts
  as live. In the Dynamic Type flow, tapping Garage with the end card up leaves the end card drawn over the Garage, the
  Garage's own header and avatar on top (`dynamic-type/phone/010-garage.png`). The free drive's own end card says
  "0 corners" and "Not enough clean corners for a score" with Open in the Log solid: honest, but a card whose primary key
  is a page with nothing on it should be a toast.
- **Build.** On drive end, clear `live` regardless of which scene started it (`web/cockpit.js` endDrive and `in_car.js`);
  the end card closes on any tab change; a free drive with 0 corners ends in the status line ("Saved · 0.7 mi · no
  corners") instead of the card. Add both to `e2e/smoke.js` as an after-drive assertion (deck visible, no `.end-card` on
  tab change).
- **Cost.** S.
- **Done looks like.** `free-drive/phone/021` shows the full deck; `dynamic-type/phone/010` is the Garage alone.

## What I'd protect

1. **The drive.** The strip, the voice with its silences and sign-off, the binnacle and the report sheet
   (`billet/phone/004` to `103`, `guided-drive/phone/074`). It is the only reason anyone will tell a friend. Do not add a
   single thing to it in this round.
2. **The end card as a moment** (`tabs/phone/014`): one number, one sentence, two actions. R-5 touches only the edge
   case with no score.
3. **"Unknown is `--`" and the Not-doing list.** Surface `--` on the route card (`planning/phone/004`), the greyed
   "Example" on People read as not real. No streaks, no badges for distance, no nag. R-1's nudge is opt-in and weekly for
   exactly that reason.
