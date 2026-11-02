# AR · Arjun Mehta · brand and type

Evidence: recording 7 (`r7/`), the code (`web/themes.js`, `web/instruments.js`, `web/index.html` lines 456 to 463 and
691 to 751, `web/fonts/`, `web/brand/`), the mockups in `docs/design/png/`. Billet has no photos this round; everything
I say about it is read from the code and the mockup, and I say so where it matters. Every r7 photo is night (the
simulator clock was 22:45 to 23:10), so Roadbook day is judged from `screens-v3/after-replay-roadbook.jpg`.

## First impressions

The one thing Vetta owns is the tulip. A right-hand corner, entry dot at the bottom, red apex on the inside: it is the
app icon, the mark beside the wordmark, the head of the notes strip, the glyph on every row of the deck (`first-run
009-idle-map`: Mount Hope Road and the loop both carry one), the Map tab. That is a brand. It was drawn once, at one
stroke, and it is carried everywhere. Most car-app marks never get this far.

Everything else is borrowed, and borrowed from the same two shops. Barlow Condensed ExtraBold plus Inter Tight is the
house pairing of every sim-racing overlay and telemetry dashboard made since 2019; it says "data app" before it says
"Vetta". Worse, the brand speaks in two voices at once: the wordmark is tracked monoline geometric caps at a uniform 8.5
stroke (`web/brand/logo.svg`), elegant and quiet, and two lines under it the tagline shouts in condensed ExtraBold at
50 px (`first-run 001-opening`). A watch company would not let its dial type contradict its logotype. Here the section
heads do it on every page: "Garage", "Log", "Friends", "You", "Your cars" are all set in the numeral face
(`tabs 022-log`, `025-garage`, `signed-in 001-friends`), and REVIEW.md's own principle 2, "numerals are instruments,
prose is captions", is broken by the headings.

The themes are the bigger truth. The brief promises three materials: paper, a VFD, machined aluminium. The code ships
three palettes. Tapedeck is Menlo with a text-shadow (`themes.js` fonts.ui and fonts.num both `"SF Mono", "Menlo"`;
`index.html` 706 to 718), applied to the whole app, so the Garage becomes an IDE (`tapedeck-night 001`, `002`). The
"5 x 7 dot font for calls" the review promised (REVIEW.md 118, 293) does not exist; `web/fonts/` holds Barlow and Inter
only. Billet, from the code, is a 1 px repeating gradient for brushing, a dashed circle for the knurl, four small circles
for screws and a red text-shadow (`index.html` 737 to 751, `instruments.js` 545 to 553). Its picker card is a grey
gradient with a red 42 (`tabs 027-garage-2`): the Roadbook night card with a glow. And two of the three themes have no
day at all; "reads in direct sun" is true of one.

What is right, and very right: the welcome (`first-run 001`) is the best brand moment in the app, mark, line, live
strip, one red key. The end card (`tabs 015`) and the Log hero (`022`) have real hierarchy: a stamped 793, a small
/1000, a quiet caption. The route card's three stamped numbers over the profile (`planning 004`) are instrument
typography. The bones are good. The letters and the materials are not yet Vetta's.

## Proposals

### AR-1 · Tapedeck gets its own letters, and stops dressing the Garage

**Why.** A VFD head unit has two kinds of type: seven-segment digits and a 5 x 7 dot matrix. Vetta has the digits
(`tapedeck-night 015`: the 38 is right, ghost segments and all) and then sets "HAIRPIN LEFT", "CAREFUL · LONG", "REC
1.33 MI · ABOUT 30 MIN LEFT" and the quiet line in Menlo with a glow (`015`, `045`). Menlo is a terminal face; nobody's
Alpine ever printed in it. The theme then recolours every prose page too: the Garage's paragraphs, the theme cards, the
tab labels all in monospace teal (`001`, `002`). The owner's "beautiful LCD" is a cockpit, not a settings page. This is
the theme people will screenshot, and today the screenshot says "retro terminal", not "1998 head unit".

**Build.**
- A 5 x 7 dot-matrix glyph set drawn in-house: caps, digits, `- . · / ' ,` and the degree sign, about 60 glyphs, as an
  SVG symbol sheet or a small bitmap-outline woff2 (OFL-free, ours). Dots are circles on a 1-unit pitch with a 0.42
  radius so the matrix shows at 16 px and reads at 21 px; the call's minimum size (21 px) and 7:1 contrast still hold.
- Where it goes: the strip's call head and tail, the next cells' codes, the binnacle labels (MPH, SCORE, SURFACE,
  BRAKE / TURN), the REC line, the quiet line. Seven-segment stays for every number (speed, distance, trip, score).
- Where it does not go: the Garage, Log, People, route card, sheets. Those keep Inter Tight and the theme's colours. A
  theme is the cockpit's skin; the map, the strip, the binnacle, the keys. `themes.js` fonts.ui goes back to Inter Tight
  for Tapedeck, and the dot face is set on `.notes` and `.binnacle` only.
- Unknown is `--` drawn in the matrix, two dots wide per dash, same slot as a known value.
- Kit stays on his 14 x 12 grid; the same dot pitch as the text so he and the words are one display.

**Cost.** M.

**Done looks like.** `tapedeck-night 015` with the call in dots and the digits in segments can be mistaken for a photo
of a head unit; `tapedeck-night 002` (the Garage) looks like Roadbook's Garage in Tapedeck's colours, in Inter Tight.

### AR-2 · Billet is a tint; make it a material (judged from the code, not photos)

**Why.** Billet failed to record, so I read it. `index.html` 737 to 751 and `instruments.js` 545 to 553 are all of it:
the panel is a vertical gradient with 1 px stripes, the bezel is one dashed stroke (`stroke-dasharray: 1.2 1.6`), the
screws are four circles, the speed and distance get `text-shadow: 0 0 8px` red, the keys get a two-stop gradient.
There is no light source, no chamfer, no depth, and in day and night the panel is the same graphite (`themes.js` billet
day and night both `#1C1D1F` / `#151618`). The mockup (`png/08-drive-billet.png`) has what the code lacks: a brushed
ring with a direction, a step down to the black face, a white Limit sign that looks like a sign, red numerals you could
read with the glow off. The picker's Billet card (`tabs 027`) is a grey gradient with a red number; next to Roadbook
night's card it is the same card. A Pro theme that is a tint will not sell, and it tells the owner's "machined metal
with glowing red gauges" story as a filter.

**Build.** A short material spec, then three renderers that obey it.
- One light, top, slightly left. Every raised edge is 1 px lighter on top and 1 px darker underneath; every recessed
  face the reverse. This single rule gives the bezel, the keys, the odometer window and the strip band their depth.
- The bezel: an outer ring with radial brushing (a `conic-gradient` of 180 thin light/dark pairs masked to the ring),
  a 2 px chamfer (light top-left, dark bottom-right), then a 1 px black gap, then the face. The knurl is 72 radial
  ticks on the ring's edge, not a dashed circle. Screws have a slot and sit at 45°, 135°, 225°, 315° as now.
- The face: `#0D0D0E`, printed scale in bone, red needle with a dark counterweight; the numerals in Barlow Condensed
  700 red, glow additive and under 60 percent alpha so they pass 4.5:1 with it off (the contract already says so).
- Day and night as two finishes, not one: day is bare aluminium (panel `#C9CACE` with the brushing, black faces, red
  deepened to `#D81E1E` for 4.5:1 on the metal); night is black anodised (today's graphite). Tapedeck can stay one
  glass; metal cannot.
- The theme-picker card is a 1:1 render of the real strip and dial renderers, not `.tp-billet`'s gradient.

**Cost.** M.

**Done looks like.** The production drive screen beside `png/08-drive-billet.png` at 1:1 shows the same depth, and a
day photo of Billet exists in the next recording. With the glow turned off in the inspector, nothing becomes
unreadable.

### AR-3 · One voice: the numeral face is for numbers and calls, nothing else

**Why.** The wordmark is a quiet monoline (`logo.svg`); the tagline under it is condensed ExtraBold at 50 px
(`first-run 001`). The page heads "Garage", "Log", "Friends · Crews", the Garage's "You", "Your cars", "Look and
voice" are condensed (`tabs 025`, `022`, `signed-in 001`); the prose under them is Inter. Drive names in the Log rows
and the end card are condensed too ("Carolina Trace Road", `tabs 015`, `022`), so a road name is set like a speed. Two
display voices on one screen is the clearest sign that the type was picked by default rather than chosen. The fix is
cheap because the hierarchy already works; it only needs one hand.

**Build.**
- Barlow Condensed is used for: measured numbers (speed, distance, time, score, climb), the call head and codes, the
  Limit sign's number, dial scales. Nothing else.
- Headings, the tagline, section heads, drive and road names, the eyebrow "DRIVE SAVED", tab labels: Inter Tight 600
  or 700, tracked `-0.01em` to `-0.02em` at 22 px and above, sentence case. The tagline at 34 px / 1.1 in 700.
- Icons at the mark's stroke: the mark is a 9/100 stroke; draw the tab glyphs, Layers, the gear, the People shield,
  the chevrons at the same relative weight (about 2 px at 24 px), round caps where the tulip has them. Replace the
  system filled-circle "i" on the map (`tabs 007`, bottom right, the only iOS glyph on the screen) with an outlined
  circle and a stem at that weight.
- The three theme cards keep their own type inside the preview only; their names and blurbs are Inter.

**Cost.** S.

**Done looks like.** On every screen, a condensed glyph is a number or a call. The welcome reads as one hand: mark,
wordmark, tagline, strip. A designer can name the two faces and say what each is for in one sentence.

### AR-4 · Night Roadbook is a dark mode; make it paper turned over

**Why.** Night Roadbook is `#151310` flat with cream type (`tabs 007`, `029`, every r7 photo). It is a competent dark
theme and it has nothing of paper in it: no grain, no warmth, no sense that the page turned. REVIEW.md's principle 4
says paper has texture; day has none either (`screens-v3/after-replay-roadbook.jpg` is flat `#EDE4D3`). The dials are
the only things on the night screen with a surface (the drum, the bezel rule). Since Roadbook is the one theme
everyone sees, the material argument starts here, not with Pro.

**Build.**
- A paper grain: a tiled 128 px noise PNG at 3 to 4 percent opacity over `--panel` and `--stage` (one asset, under
  10 KB, `background-blend-mode: multiply` by day, `screen` by night). Tested at 390 px so it never moirés with the
  scanline rule Tapedeck uses.
- Night paper warmer and a step lighter: panel `#1C1813`, stage `#201B15`, so the cream type sits on something rather
  than on black. Check the quiet line and MPH stay over 4.5:1 (today 4.95 and 5.59; the lighter panel costs about 0.3).
- The 2 px ink rules under the strip and above the binnacle get a 1 px lighter hairline beneath them at night, as a
  printed rule shows through from the other side of a page.
- No other change: layout, hazard plate and keys stay as the contract fixes them.

**Cost.** S.

**Done looks like.** A night screenshot next to a day one reads as the same object in two lights, not two apps. The
contrast table in `contrast.md` has no new row under 4.5:1.

## Did round 1 land?

As typography, yes: the warning-first grammar makes a clean lockup, head big, caution in red under the distance
(`first-run 003`: OPEN LEFT / TIGHTENS; `tabs 007`: OPEN RIGHT), and one notation in the next cells ("MEDIUM R",
"OPEN L", "TIGHT L") reads as a system. Your roads on the deck (`first-run 009`) gave the tulip its best new home: two
rows, two tulips, two verbs. The end card and the Log hero are the two most handsome screens in the app now.

## What I'd protect

1. **The tulip as the mark and the strip as the brand's hero.** One drawing, one stroke, red apex, everywhere. Do not
   add a second mark, a mascot outside Tapedeck, or a lettered icon.
2. **Stamped numbers with a small denominator and a quiet caption** (`793 /1000 · VETTA SCORE`, `9.0 mi · 23 min · 34
   corners` over the profile). That lockup is the house style; every new number should use it.
