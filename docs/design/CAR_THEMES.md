# The two car themes: Tiburon and FR-S (private, 2026-11-03)

The owner's verdict on the first cut: "car specific themes need to be much more car specific and should have access to any
voice pack." Each theme now mirrors the real cluster, carries the car through the arrow on the map, the car map, the
Garage card, the share card, the finish and the sounds, and any voice pack goes with any theme (Garage, Look and voice).

Where it lives: every car-specific detail is data in `backend/src/private_themes.json` (`car`: cluster parts, outline,
paint, needle/chrome/inner-dial/lamp colours, finish, numeral style, sounds), sent by `GET /api/me` only to a granted
account. The public code (`web/instruments.js carGauge`, `web/themes.js carFrom/carSVG`, `web/index.html` `.car-*` and
`data-finish`) knows no car. `tests/test_private_themes.py` checks that the names, paints, outlines and sounds are not
in the public web files. The data is regenerated from a script kept outside the repo; edit the JSON directly.

## Honest mapping

Vetta measures speed (GPS), Turn and Brake (the phone's g) and Bank (camber, once calibrated). Nothing else. A gauge the
car has for something else is drawn as the car has it and its needle rests at its stop, dimmed, like every unmeasured
needle in the app (`CAR_READS`, `carReading`: `rpm`, `fuel`, `temp`, `torque`, `volts`, `mpg` always read null).

| Car | Real gauge | In Vetta |
|---|---|---|
| Tiburon | speedometer, left, 0-160 MPH, km/h 0-260 inside | the dial: speed, its needle, pace/Sight/Limit marks, the digital speed under the hub (the 40 px floor) |
| Tiburon | three-gauge pod over the radio: torque, instant fuel use, volts | the meter: Turn (centre zero), Brake, Bank; Bank readout under it |
| Tiburon | tachometer, right, 0-8 x1000 rpm, red from 7 | not on the binnacle (three slots: speed, Limit/Sight, meter); see "Not done" |
| FR-S | centre tachometer 0-9 x1000 r/min, red zone, REV lamp, digital speed, MID | the dial: the tach face with its needle at rest (no engine data); speed in digits; PACE in the window right of the hub; the REV lamp lights in the warning red when you are over the corner's pace |
| FR-S | right dial: fuel (top), coolant (bottom), needles from hubs on the centre line, scales on the right | the meter: Turn (L to R) on top, Brake (0 to .8 g) below; Bank where the warning lamps sit, on the left |
| FR-S | analog speedometer, left, 160 MPH | not on the binnacle; the speed is the tach's digits, as many FR-S drivers read it |

The contract holds: the red zone is printed in the theme's one red (a limit, not a reading); needles are a reading and
`theme_contract.js` keeps a car's needle colour 90 apart from the signal and 3:1 on its face; the arrow's outline is the
panel ink, 3:1 on the map; a car dial must carry the speed numeral, a car meter the Bank readout.

## Sources

- FR-S cluster layout, gauges and REV indicator: Toyota, *2014 Scion FR-S Owner's Manual* (OM18027U), "Gauges and meters"
  p.151 (illustration CTH22AW052: analog speedometer left, tachometer centre, digital speedometer in the tach, fuel and
  coolant in the right dial, odometer/MID below the tach hub), "Indicators and warning lights" p.155 (CTH22AW076), REV
  indicator p.125 and p.161 (set from 2,000 to 7,400 r/min; flashes when the red zone is entered; a buzzer).
  https://assets.sia.toyota.com/publications/en/om-s/OM18027U/pdf/OM18027U.pdf . The tach's 0-9 numerals, ~23 degrees per
  1,000 and the red zone from about 7,500 were measured off that illustration.
- FR-S "large center-mounted tachometer is the focus of the three-gauge cluster ... Speed is monitored by both digital and
  analog gauges": Toyota press release, 2013 Scion FR-S, Nov 2011 (pressroom.toyota.com, generate_pdf=46820).
- FR-S redline 7,400 rpm: The Auto Channel 2013 FR-S review; D-Sport spec sheet. Speedometer 160 MPH: OEM cluster listing (eBay).
- FR-S cluster LEDs white (BRZ's amber/red), black gauge faces: revlimiter.net gauge-face FAQ; Subispeed Magna face listings.
- FR-S red stitching on seats and wheel, red seat accents, "carbon fiber-like dash inserts", Ultramarine "a deep and
  fathomless blue": DriveChicago 2013 FR-S review.
- FR-S paint name and code, Ultramarine Pearl (E8H): PaintScratch 2013 Scion FR-S colour list.
- Tiburon cluster layout, ranges and night colour: whitegauges.net 2003-2006 Tiburon/Tuscani overlay (kit: 160 MPH
  speedometer with km/h 0-260 inside, 8,000 rpm tachometer with red from 7, temperature and fuel; photos of the cluster
  with the overlay on the stock lighting, orange at night; "use the stock lighting"). newtiburon.com threads (search
  summaries; the forum itself is paywalled to fetchers): white bulbs behind an orange filter / orange LEDs.
- Tiburon faces "white backgrounds and red needles": a 2006 Tuscani review quoted in a search summary (not opened).
- Tiburon multi-gauge (torque 0-400 Nm, instant fuel 0-30 MPG, volts 8-16 V, above the audio): Hyundai service-manual
  excerpt and owner's manual p.58 (manualslib, Tiburon owner's manual "Multi gauge (if installed)"); Hyundai part
  94320-2C300 "multi-gauge set, volt, torque, fuel".
- Tiburon GT trim: "leather bolsters with cloth inserts", "contrasting red stitching" on seats, door inserts and the
  leather-wrapped wheel, "metal-grain interior trim", 2.7 V6: modernracer.com Tiburon V6 history (2005 updates).
  Red double stitching on a perforated black door insert: Wikimedia Commons, "Tuscani 2.0 '03 (8906985324).jpg".
- Tiburon paint: Sterling Metallic (TW) is the only silver on PaintScratch's 2005 Tiburon list.
- Body proportions for the outlines: Wikimedia Commons GK and facelift photos ("HYUNDAI COUPE (GK) China" series,
  "Hyundai Coupé GK Facelift Sanming"); lengths and widths from memory of the published specs, so the outlines are
  stylised, not traced.

## Not confirmed (drawn as the closest honest thing, or left out)

- That the US 2005 Tiburon **GT** had the three-gauge pod: Hyundai's 2005 material ties it to the **SE**. Kept because the
  owner says the co-developer's GT has it; if not, swap the meter for the speedometer-side twin gauges.
- The stock Tiburon face colour (white per one review; "white, silver or black" per a face seller) and the stock typeface:
  drawn white-silver with a rounded sans (`numerals: rounded`, the phone's Arial Rounded where present).
- The Tiburon's exact needle shade and hub cap; the multi-gauge's housing shape and face colour (drawn as the main dials).
- The FR-S needle colour (not found): left in the face's white. The FR-S numeral typeface: a DIN-like sans where the
  phone has one. The FR-S km/h version of the speedometer.
- The FR-S tach face texture and whether its inner disc is a different shade: drawn a shade lighter, as the manual's
  illustration outlines it.
- Seat fabric patterns (both cars) and the paints' exact colours: the paint hexes are by eye, not measured.
- Either car's door chime or switch sounds: the key and pre-call sounds are synthesised evocations (the FR-S pre-call is a
  short double buzzer like its REV indicator's), not recordings.
- Red stitching is real in both cars but is not drawn: red is the warning's alone in Vetta.
