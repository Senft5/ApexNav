# STATE

## Session 2026-11-14 (carplay arrived): the car says Arrived at the end of the route (claude/project-thread-me97iw)
- At the end of a route the car's card sat on "Arriving at your destination" at 0 ft for the rest of the drive. Within 40 m of the end of a route to somewhere (not a loop), the page now sends `arrivedMessage` (web/carplay.js), and the car shows CarPlay's own paused trip with `.arrived` ("Arrived · Maryville", or just "Arrived" when the name is too long for a glance), as Apple Maps ends a trip. The drive keeps recording until End, as before.
- Next: TestFlight on Nate's car.

# CALL SHEET

## 2026-11-14 (carplay arrived): Arrived pauses the trip, it doesn't end the drive (claude/project-thread-me97iw)
- Why: the drive is the driver's (they may park or drive on); the phone's End decides when it is saved. The card just stops claiming a maneuver.
- Undo: drop the arrived branch in cockpit.js carGuide.
