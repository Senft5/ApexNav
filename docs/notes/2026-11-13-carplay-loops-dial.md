# STATE

## Session 2026-11-13 (carplay loops): the car's Loops list is the phone's loop dial (claude/project-thread-me97iw)
- The phone's loop dial is set to distance by default (15-90 mi, or 25-150 km) or to time; the car offered only its five times. The page now sends the dial's five rows (`loopsMessage`, web/carplay.js) on hello and whenever the dial or the units change, and the car sends back the minutes or the miles; the page takes only a length the dial has.
- One set of lengths: cockpit.js labelLoops reads `ApexCarPlay.LOOP_MI` / `LOOP_KM`.
- Next: keep checking phone/car parity.

# CALL SHEET

## 2026-11-13 (carplay loops): the car follows the dial's setting rather than offering both (claude/project-thread-me97iw)
- Why: five rows fit the car's list without scrolling, and the driver picked distance or time on the phone already; ten rows would be a wall.
- Undo: send `loopsMessage('time', …)` always, or both sets in two sections.
