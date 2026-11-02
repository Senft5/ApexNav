# HE · Helen Cho, automotive journalist · round 2

Evidence: recording 7 (`r7/`), the flows named below, the code in `web/`.

## First impressions

I've been handed a lot of "driving apps" over the years and most of them are a playlist with a map. This one has a
story, and the story is the voice. Read the guided drive's transcript end to end: "Careful, tight right", "Hairpin left,
long", "Easy left, long, then careful, square left in a quarter mile", and then, at 20:34, "That's the last corner.
Lovely road. Score six hundred." That is a rally co-driver riding in a free app, and it reads a road in Cincinnati I've
never heard of with the confidence of someone who's driven it. The headline writes itself: *the app that reads the road
to you.* The idle deck backs it up (`first-run/phone/009`): "Mount Hope Road · Not driven yet · 6.6 mi from here · 11
good corners · Dry now." That's a lede, not a search bar.

Here's my problem as the person who'd write the piece. The thing the mission statement is actually about, every
phone a 100 Hz probe mapping how a road *physically feels* in five-metre slices, is invisible in 290 photographs. Bank
reads +0.0° from the first corner to the last (`guided-drive/phone/050`, `120`, `200`, `285`). The route card's Surface
dial is a dash with "Road feel after first drive" under it (`planning/phone/004`), and after the first drive the Log
shows Speed, Cornering g, Brake and throttle, Elevation (`guided-drive/phone/289`), and nothing a phone felt through
the road. I checked: the fixture the rig replays, `web/data/dry_ridge.js`, carries `camber_deg`, `roughness_rms` and
`crest_vertical_g` for every five metres. The data exists. Nobody is allowed to see it, including the driver who made
it. I can't photograph the headline, so I'd have to write the smaller story.

The second thing: this is a product called Roadbook with no roadbook. The notes are a lovely document that exists
only as sound. And the brochure doesn't match the car: the theme cards sell "LEFT 4 · TIGHTENS" and "Open left,
tightens. Watch the exit, it closes." (`tabs/phone/026`), while the strip says "MEDIUM RIGHT" and the voice never
said "tightens" once in 28 lines.

The bones are remarkable. The remarkable part is hidden.

## Proposals

### HE-1: Show me what my phone felt
- **Why.** The one claim no other navigation app can make is the one the app never shows. A journalist cannot write
  "it maps camber and bumps" over a screenshot that says BANK +0.0° for twenty minutes. Evidence: `guided-drive/phone/050`,
  `120`, `200`, `285` (bank never moves); `289` and `290` (four lanes, none is road feel); `planning/phone/001` and `004`
  (Surface "–", "Road feel after first drive", on a road the fixture has already measured). `web/drive_view.js:352`
  draws a Road feel lane only from *member* aggregates ("no member data on this road yet"), never from the drive's own
  rows, although `cockpit.js:23` already loads `camber_deg` and `roughness_rms` per drive. Rule 3 says unknown stays
  unknown; a zero that never moves is worse than "--", because it reads as measured.
- **Build.**
  1. Drive page: a fifth lane, **Road feel**, from the drive's own rows: camber as a signed band (±8°), roughness as a
     thin bar, crests as ticks, labelled "this phone · 1 run" so it's never mistaken for the crowd's number. Member data
     stays the second, fainter layer it is today.
  2. End card: one measured sentence under the score, from the same rows: "Banked 4° through corner 7 · roughest at 3.1
     mi." Nothing when the mount never calibrated (`cockpit.js:5350`).
  3. Route card: the Surface dial fills from your own passes of that road when you have any, with the label "your 1
     run"; the members' value, when present, is drawn as the second needle. Same for the route card's "Road feel" line
     (`cockpit.js:2234`).
  4. The rig: the review replay should feed the fixture's IMU columns through the live pipeline so Bank moves in the
     pack, and when it can't, the dial must show "--", not "+0.0°". A test pins "camber null never prints a degree".
- **Cost.** M.
- **Done looks like.** Next pack: `guided-drive` shows a moving bank reading at the hairpin, the drive page has a fifth
  lane with real banking on Dry Ridge, and the end card's sentence names a corner and a rough patch.

### HE-2: The printed roadbook: read the notes before you drive
- **Why.** The transcript is the best writing in the app and you can only hear it, in the car, at speed. Before a
  drive, all a reader gets is "Ahead: Esses at 2.4 mi · Technical at 3.4 and 8.5 mi" (`guided-drive/phone/001`) and a
  Preview that flies over the map (`cockpit.js:3839`). A rally crew reads the notes the night before. A magazine would
  print them. A Roadbook theme without a roadbook page is a costume.
- **Build.** A "Notes" link on the route card opens a page: the route's corners in order, one row each in the strip's own
  notation (distance from the last, tulip, the call in the co-driver's words from `paceNoteText` and `plainNamed`, the
  modifiers, the hazard plates in their orange), grouped by road name with the road's miles and corner count as a
  running head. Scrollable, Dynamic-Type friendly, and "Save as image" renders the same page at 1080 wide in the active
  theme (the share card's sibling in `drive_card.js`). The Log's drive page gets the same page from the drive's own
  notes, so a finished drive also leaves a document.
- **Cost.** M.
- **Done looks like.** From `planning/phone/004`, one tap shows thirty-four rows that read like the transcript; the saved
  image of Dry Ridge Rd is something I'd put in the piece.

### HE-3: The brochure matches the car
- **Why.** The theme picker's swatches say "LEFT 4 · TIGHTENS" over "42 MPH" and quote "Open left, tightens. Watch the
  exit, it closes." / "Easy in, late out." / "Late apex." (`tabs/phone/026`, `027`, `signed-in/phone/005`). The product
  says "MEDIUM RIGHT" with "CAREFUL · LONG" (`guided-drive/phone/017`), and the voice packs, across 42 spoken lines in
  three flows, never say "tightens", "late apex" or "easy in". Round 1 built a call grammar (M-1) and the picker still
  advertises the old one. A reader who buys Pro on that card gets a different co-driver than the one shown.
- **Build.** The swatch draws a real strip head from the current notation: "MEDIUM RIGHT · 150 ft · CAREFUL · LONG"
  with the tulip, in each theme's type. The quoted line comes from the pack's actual bank (one of its real calls plus one
  of its sign-offs, e.g. Marguerite: "Careful, square left, then easy right in a quarter mile." and "Lovely road.").
  A test checks every picker quote is a line the pack can say.
- **Cost.** S.
- **Done looks like.** `tabs/phone/026` and `027` show the same words the strip and transcript use.

### HE-4: The share card, photographed, in the Log's words
- **Why.** The end card's one solid key is Share card (`guided-drive/phone/286`, `tabs/phone/015`) and no recording has
  ever shown what comes out of it. In code, `drive_card.js:cardModel` prints Smoothness, Braking, Consistency; the Log
  prints Pace, Smooth, Brakes, Rhythm (`guided-drive/phone/287`). The one artefact people will post is in a vocabulary
  the app itself doesn't use, and nobody has looked at it. (RA-4 is about where the card links to; this is about the
  card.)
- **Build.** The card's four parts are the Log's four, same order, same names, same numbers; the rig taps Share card
  and photographs the sheet and the rendered PNG; the card carries the road's silhouette with the corners ticked and,
  once HE-1 lands, one road-feel line.
- **Cost.** S.
- **Done looks like.** The pack contains `share-card.png`; it says Pace 63 · Smooth 63 · Brakes 100 · Rhythm 21 under
  600, exactly as `287` does.

## Did round 1 land?

Yes, where it matters. The call grammar is now one voice: 28 lines in the guided drive read as a single co-driver, the
warning first, the link ("then careful, square left in a quarter mile") in the right place. The deck row with a named
road and a reason (`first-run/phone/009`) is the best screen in the app. End became Undo (`guided-drive/phone/285`) and
the end card arrives whole (`tabs/phone/015`); the dots in `286` are just the worker still scoring.

## What I'd protect

- The voice's sign-offs and its restraint: "Lovely road.", "That's the B-side done.", "Quiet from here. Bumps and cameras
  only." Nobody should make these chattier.
- The route card's spec sheet: three stamped numbers, the elevation with corner ticks, "Ahead: Esses at 2.4 mi".
  That's how a road test reads.
