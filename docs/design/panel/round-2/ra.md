# Ray Castellanos, the product skeptic: round 2

Evidence is recording 7 (`scratchpad/r7`), paths relative to the pack. Where I read code to name a cause I say so. Free
forever is the promise, so nothing below is about money.

## First impressions

Last round I said the drive is the product and the week between drives is empty. Round 1 put something in the week, and
it shows. On first run the deck now names a real road with a real reason: "Mount Hope Road · Not driven yet · 6.6 mi from
here · 11 good corners · Dry now" (`first-run/phone/009-idle-map.png`), and the Dynamic Type map does the same with Morgan
Road (`dynamic-type/phone/001-map.png`). That is the first time this app has given anyone a reason to open it that the
user didn't bring. Good. It is not yet reliable: the tabs flow's idle map, a few miles away, is back to the bare dial
detent, "Loop from here · 45 mi · On the twistiest roads nearby" (`tabs/phone/001-map.png`).

Now the harder thing. Round 1 built well and then did what teams always do after a win: it bolted the new verb onto every
surface. The end card I asked us to protect, one number, one sentence, two actions, now has five: Share card, Mark a stage,
Drive it again, Open in the Log, Done (`tabs/phone/015-drive-ended.png`). On a 0.6-mile stretch of Northwest Expressway with
0 corners and no score it offers Mark a stage and Drive it again (`dynamic-type/phone/006-drive-ended.png`). Nobody drives an
expressway on-ramp again. The drive page has six keys in two rows, including "Share" and "Share card" side by side
(`tabs/phone/016-in-the-log.png`); the route card has Save, Share, Share ETA, GPX, Pin place (`planning/phone/005`). That is
the "list of capabilities with boring buttons" the owner complained about, growing back one honest feature at a time.

Then trust. The end card says 3 corners, the drive page says 3 corners, and the Log row for the same drive says "2 corners"
while drawing three red ticks (`tabs/phone/015`, `016`, `022-log.png`). The year line says 1 mi, the week line under it
1.3 mi (`tabs/phone/022`). A product whose whole pitch is "we measured your road" cannot disagree with itself on one screen.

And the social half is still unseen. People is a greyed Example friend and a greyed Example crew, with "1 crew near you" the
only sign of life (`tabs/phone/023-friends.png`, `024-crews.png`). Two rounds in, no panelist has seen a crew do anything.
I still can't tell you whether it is a product or a pile of tables. 119 scripts under `web/` and a 6,936-line
`cockpit.js` tell me which way the effort has gone.

## Proposals

### RA-1: The crew drive, end to end, seen with people in it
- **Why.** The only question about the social half that matters is "what does a crew do together on Sunday", and two
  recordings have not answered it. Crews is an Example card (`tabs/phone/024-crews.png`); Friends is an Example friend
  (`signed-in/phone/001`). Round 1 ranked my seeded world 2 points and deferred it (`round-1/VOTE.md`, "next round"). It is
  next round. Meanwhile the scaffold keeps growing: crew page, events, standings, voice, convoy, flyby, legends, builds
  (`web/crew_page.js`, `crew_events.js`, `crew_standings.js`, `crew_voice.js`, `convoy.js`, `flyby.js`, `legends.js`,
  `builds.js`). The deck already ranks a crew drive first (`crewSoon` in `web/cockpit.js`, `suggest` in
  `web/your_roads.js`), and no recording has ever triggered it.
- **Build.** (a) A review world behind `APEX_REVIEW=1`, served by stubs the way `e2e/smoke.js` stubs the Worker, written
  nowhere (the held-POST rule): two friends, one crew of four ("Ridge Runners") with a Sunday 9 AM drive on Dry Ridge Rd that
  the review account is Going to, one past crew drive with three members' scores on the same road. (b) A `crew` flow in
  `UITests/ReviewFlows.swift`: idle map (the deck's top row must be the crew drive), People > Crews > the crew page, the
  drive card, RSVP, then the guided drive on Dry Ridge, then the end card. (c) The one new piece of product: after a drive on
  a road your crew drove that week, the end card's sentence line names the crew's result, measured only ("Ridge Runners on
  Dry Ridge this week: you 788, Sam 801, 2 others drove"). One line, no new key. Everything else in the crew page is frozen
  until this flow has been judged.
- **Cost.** M.
- **Done looks like.** `INDEX.md` lists a `crew` flow; its idle map plate reads "Sunday 9 AM · Dry Ridge Rd with Ridge
  Runners · Going"; its end card shows the crew line; the next panel can vote on crews from photos instead of from
  filenames.

### RA-2: Two keys on the end card, three on the drive page
- **Why.** The end card is the moment people decide whether to tell someone. It went from two actions to five
  (`tabs/phone/015-drive-ended.png`), and offers Drive it again and Mark a stage on a cornerless expressway
  (`dynamic-type/phone/006`). The CALL_SHEET says Drive it again is hidden under 1 km; the photo shows it at 0.6 mi
  (`$('endAgain').hidden` in `web/cockpit.js` tests `len_m`, which evidently isn't the 0.6 mi the card prints; and it never
  checks corners or `isRoadName`). The drive page puts Share next to Share card (`tabs/phone/016`).
- **Build.** End card: one solid key and one text key. Scored drive: Share card (solid), Done. Unscored or 0 corners: Done
  only, the status line already says "no corners to score". Drive it again appears in place of Share card only when the drive
  is a road you have driven twice or more (`roads()` `runs >= 2`); first drives go to the deck, where it already lives.
  Mark a stage and Open in the Log leave the card; tapping the score or the road name opens the Log page. Drive page: Replay
  (solid), Drive it again, Share (one sheet: the card picture or the route); Compare and Mark a stage move under a "More"
  row. Route card: Drive it and Preview, then Save and Share; Share ETA, GPX and Pin place go inside Share.
- **Cost.** S.
- **Done looks like.** `tabs/phone/015` shows 793, the sentence, Share card, Done. `dynamic-type/phone/006` shows "0.6 mi ·
  no corners to score" and Done. `tabs/phone/016` has one row of three keys.

### RA-3: One set of numbers everywhere
- **Why.** The pitch is measured truth, and the Log contradicts the end card on the same drive: 3 corners on the card and the
  drive page, "2 corners" with three ticks on the Log row (`tabs/phone/015`, `016`, `022-log.png`). The year summary rounds
  1.3 mi to "1 mi" one line above "Your week: 1.3 mi" (`tabs/phone/022`). Every disagreement teaches a user that the numbers
  are decoration, and then the score stops meaning anything.
- **Build.** One function owns a drive's displayed facts (distance, time, corners) and every surface reads it: end card,
  drive page, Log row, Your week, year line, share card, your_roads `roadLine`. If the Log row counts scored corners and the
  card counts detected ones, pick one definition and label the other if it must appear. Distances under 10 mi carry one
  decimal everywhere. Add a test that renders the review drive through each surface and asserts the same three numbers.
- **Cost.** S.
- **Done looks like.** `tabs/phone/015`, `016` and `022` agree on corners and miles; the test is in `tests/`.

### RA-4: The share card lands somewhere (carried from R-2)
- **Why.** Still the question "what makes people show each other", still unanswered. The end card's primary key is Share
  card (`tabs/phone/015`) and it exports a picture with no link (`web/drive_card.js`). A friend sees "793 · Carolina Trace
  Road" in a group chat and has nothing to tap. This is the only growth path a free app with no ads and no notifications
  by default has, and round 1 gave it 1 point.
- **Build.** The share sheet carries the image and a URL. The URL is a road page (`web/road_page.js` rendered on the site by
  stage or road id) showing the road only, never the drive or the time, with "Drive it in Vetta" opening
  `apexnav://open?road=` when installed and the App Store listing when not. The card prints the short link on its bottom
  rule. Universal Links need the owner's domain (OWNER_TODO); the page and the printed link do not.
- **Cost.** M.
- **Done looks like.** The share-sheet photo shows an image and a link; a browser capture of the road page with the Drive it
  key; the card's last line is the URL.

## Did round 1 land?

Half. The Sunday suggestion is real and good where it fired (`first-run/phone/009`, `dynamic-type/phone/001`), but not in
`tabs/phone/001`, and no recording shows the idle map after a drive with your road on it or the Reminder switch. "Comes back
whole" landed (`dynamic-type/phone/011` is the Garage alone). Drive it again landed too well: it is on every surface,
including ones where it is nonsense.

## What I'd protect

1. **The drive and its voice.** "Careful, tight right", "Quiet from here. Bumps and cameras only.", "Notes closed. Have a
   good one. Score seven hundred ninety-three." (`guided-drive/transcript.txt`, `tabs/transcript.txt`). Add nothing to it.
2. **The deck suggestion's honesty.** "Not driven yet · 6.6 mi from here · 11 good corners · Dry now" is every word measured
   or said (`first-run/phone/009`). No streaks, no "you haven't driven in 9 days", Reminder off by default.
