# STATE
## Session 2026-11-12 (roam-a chargers): EV chargers are no longer fuel stops (claude/project-thread-h7xxmf)

- Bug: the map's tiles (OpenMapTiles poi layer) file amenity=charging_station under class `fuel` (checked on real z14
  tiles: Cincinnati, Lexington and Columbus each have `fuel/charging_station` points). So a petrol car's route card
  counted a charger as a "fuel stop", it could break up the "no fuel for 60 mi" warning, it got a FUEL pin, and "next gas
  station" could name a Supercharger.
- web/stages.js `pois` now gives chargers kind `charge`. web/scenic.js `forCar(pois, car)` keeps the pumps for a petrol,
  diesel or hybrid car, or when the Garage has no car, and the chargers for an electric one.
  - `summary(list, totalM, { electric })` counts "N chargers", and an electric car's warning is "no charger for the
    first 62 mi".
  - `fuelGap(list, totalM, kind)`, KIND_NAME `EV charger`, and the ask "Next charger: …".
- web/cockpit.js: `attachScenic` filters by the Garage daily car (`routingCar()`), and an EV's chargers get CHARGE pins.
  The next-pin highlight (U-85) covers both kinds. Siri's "next gas station" in an EV answers with the next charger.
- Not done: CarPlay's route preview still lists only cafés and fuel (carplay.js alongMessage, ApexCarPlay.swift), so an
  EV sees no chargers on the car's screen yet. A charger with no name says "EV charger, no name on the map".
- Tests: tests/test_scenic.py (+1 test_chargers_are_not_fuel_stops).
- Next: car-friendly café picks (R-24's last part); chargers on CarPlay's preview.

# CALL SHEET
## 2026-11-12 (roam-a chargers): an EV's route card counts chargers, never pumps (claude/project-thread-h7xxmf)

The Garage's daily car decides between pumps and chargers. With no car, the card shows pumps, since most drivers burn fuel.
A hybrid counts as a fuel car, because it can always fill up. An electric car sees chargers only: a gas station is no stop
for it. The warning uses the same 50 mi threshold. route_ctx/car.js already plans range against the car's own range.
Undo: drop the `forCar` line in cockpit.js `attachScenic` (chargers then still stay out of the fuel count, as kind
`charge` with no pin for any car).
