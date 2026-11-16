# STATE

## Add a car opens on four fields (UI thread, 2026-11-16)
- Add a car was a wall of 16 square boxes at once. It now opens on four fields: Year, Make, Model and Nickname, under the VIN and "Fill specs" lookups.
- Everything else sits in one card row, "Specs, routing and mods", which opens with a tap:
  - Trim, Colour, Power, Weight, Drive, Gearbox and Tyres.
  - A small "For your routes" group with Ride height, Width, Fuel, Range and a one-line note.
  - Mods.
- The card opens by itself when you edit a car, and when a VIN or spec lookup fills it in, so you can check what was filled.
- The text fields now take the look's rounded shape. They had no `type`, so `input[type="text"]` never matched them.
- `web/garage_ui.js`.

# CALL SHEET

## A new car asks for four things first
- What: the car form shows Year, Make, Model and Nickname. The rest is in a `details.car-more`, open when editing (`c.id`) or after a lookup.
- Why: Nate, 11-12 and 11-16: no walls of text, Apple philosophy. A car needs only a make and a model to save, and the routing fields matter only for a daily car.
- Undo: put the fields back into the one `.car-form` in `form()`, and drop `moreBox` and the `.car-more` CSS.
