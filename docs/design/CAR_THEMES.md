# The two car themes: Tiburon and FR-S (private, 2026-11-03)

The owner's verdict on the first cut: "car specific themes need to be much more car specific and should have access to any
voice pack." Each theme now mirrors the real cluster, carries the car through the arrow on the map, the car map, the
Garage card, the share card, the finish and the sounds, and any voice pack goes with any theme (Garage, Look and voice).

Where it lives: every car-specific detail is data in `backend/src/private_themes.json` (`car`: cluster parts, outline,
paint, needle/chrome/hub/inner-dial/LCD/lamp colours, finish, numeral style, sounds), sent by `GET /api/me` only to a
granted account. The public code (`web/instruments.js carGauge`, `web/themes.js carFrom/carSVG`, `web/index.html`
`.car-*` and `data-finish`) knows no car. `tests/test_private_themes.py` checks that the names, paints, outlines and sounds
are not in the public web files. The data is regenerated from a script kept outside the repo; edit the JSON directly.

## Red (the owner's rule, 2026-11-03)

"Red doesn't need to be warnings only if it's stuff like needles or accent." A car's needles, red zone, night light and
accents may be red where the real car's are (the Tiburon's red-orange needles, its orange-red tach zone and its red night
light). The warning stays unmistakable by what only it has: its shape, its word and the hazard plate (`ALARM` in
`web/theme_contract.js`; the contract fails a theme if either is lost), with its floors kept (signal 3:1 on the panel;
the route and the calm ribbon, which run the length of the screen, stay apart from it). A needle must still read on its
face (3:1), an LCD's ink on its LCD (4.5:1), and the car's outline (the map's road casing) 3:1 on the map.

## Honest mapping

Vetta measures speed (GPS), Turn and Brake and grip (the phone's g) and Bank (camber, once calibrated). Nothing else. A gauge
the car has for something else is drawn as the car has it and its needle rests at its stop, dimmed, like every unmeasured
needle in the app (`CAR_READS`, `carReading`: `rpm`, `fuel`, `temp`, `torque`, `volts`, `mpg` always read null). A face
that carries a Vetta reading instead says so on the face.

| Car | Real gauge | In Vetta |
|---|---|---|
| Tiburon | speedometer, left, black, 0-160 MPH, km/h 0-260 inside | the dial: speed, its needle, pace/Sight/Limit marks, the digits under the hub (the 40 px floor) |
| Tiburon | tachometer, right, 0-8 x1000 rpm, orange-red zone from about 6.5 | the meter's big dial, reading grip and saying so ("x0.1 g": 8 is 0.8 g, red zone 0.65-0.8 g) |
| Tiburon | twin small gauges, top centre: coolant C-H, fuel E-F | the meter's twin gauges: Turn (L-R, centre zero) and Brake (0 to 0.8 g) |
| Tiburon | the LCD under them | Bank, in the LCD |
| FR-S | centre tachometer 0-9 x1000 r/min, red zone, REV lamp, digital speed, MID | the dial: the tach face with its needle at rest (no engine data); speed in digits; PACE in the window right of the hub; the REV lamp lights in the warning red over the corner's pace |
| FR-S | right dial: fuel (top), coolant (bottom), needles from hubs on the centre line, scales on the right | the meter: Turn (L to R) on top, Brake (0 to .8 g) below; Bank where the warning lamps sit, on the left |
| FR-S | analog speedometer, left, 160 MPH | not on the binnacle; the speed is the tach's digits, as many FR-S drivers read it |

## Sources

- Tiburon (the co-developer's car): the owner's reference photos (scratchpad `owner_refs`): the cluster close up and in the
  car (black faces, chrome rings, white numerals and ticks, red-orange needles with silver hubs, speedometer left 0-160 MPH
  with km/h 0-260 inside and "MPH km/h", tachometer right 0-8 x1000rpm with its orange-red zone from about 6.5, the twin
  coolant and fuel gauges at the top centre with turn arrows above, the LCD and the warning lamps under them); the
  co-developer's own car at night (the cluster lit red); the cabin (black dash, two chrome-ringed vents over a silver
  radio surround, red-and-black patterned GT seat fabric); the exterior (silver). These replace the earlier web sources
  for the Tiburon's cluster (a 2003-2006 overlay kit and a review that said white faces), which did not match this car.
- Tiburon GT trim: "contrasting red stitching" on seats, door inserts and the leather-wrapped wheel: modernracer.com
  Tiburon V6 history; red double stitching on a black door insert: Wikimedia Commons, "Tuscani 2.0 '03 (8906985324).jpg".
- FR-S cluster layout, gauges and REV indicator: Toyota, *2014 Scion FR-S Owner's Manual* (OM18027U), "Gauges and meters"
  p.151 (illustration CTH22AW052), "Indicators and warning lights" p.155 (CTH22AW076), REV indicator p.125 and p.161 (set
  from 2,000 to 7,400 r/min; flashes when the red zone is entered; a buzzer).
  https://assets.sia.toyota.com/publications/en/om-s/OM18027U/pdf/OM18027U.pdf . The tach's 0-9 numerals and the red zone
  from about 7,500 were measured off that illustration.
- FR-S "large center-mounted tachometer is the focus of the three-gauge cluster ... Speed is monitored by both digital and
  analog gauges": Toyota press release, 2013 Scion FR-S, Nov 2011 (pressroom.toyota.com, generate_pdf=46820).
- FR-S redline 7,400 rpm: The Auto Channel 2013 FR-S review; D-Sport spec sheet. Speedometer 160 MPH: OEM cluster listing (eBay).
- FR-S cluster LEDs white (BRZ's amber/red), black gauge faces: revlimiter.net gauge-face FAQ; Subispeed Magna face listings.
- FR-S red stitching on seats and wheel, red seat accents, "carbon fiber-like dash inserts", Ultramarine "a deep and
  fathomless blue": DriveChicago 2013 FR-S review.
- FR-S paint name and code, Ultramarine Pearl (E8H): PaintScratch 2013 Scion FR-S colour list.
- Body proportions for the outlines: Wikimedia Commons GK and facelift photos; the outlines are stylised, not traced.

## Not confirmed, or not drawn

- The FR-S needle colour (not found in any source): left in the face's white. The FR-S numeral typeface: a DIN-like sans
  where the phone has one. The FR-S km/h version of the speedometer. Its tach face texture.
- The Tiburon's numeral typeface (a plain bold sans, drawn with the phone's Helvetica/Arial); the exact silver paint name
  and both paints' exact colours (the hexes are by eye).
- The Tiburon's turn arrows and warning lamps, and both cars' seat fabric: not drawn (a lamp that never lights would be
  a false signal; the fabric is a cabin, not an instrument). Red stitching is real in both but not drawn.
- Either car's door chime or switch sounds: the key and pre-call sounds are synthesised evocations (the FR-S pre-call is a
  short double buzzer like its REV indicator's), not recordings.
