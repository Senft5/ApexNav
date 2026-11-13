# STATE
## Session 2026-11-13 (roam-a wet roads): on a wet or icy road the pace notes come earlier (claude/project-thread-h7xxmf)

- The place plate already keeps the weather where you are (place_plate.js `weather`: a fresh NWS observation,
  Open-Meteo's now and its last 3 hours of rain). refreshPlacePlate asks every 20 minutes or 5 km, while driving too.
  Until now the drive never used it.
- web/wet_roads.js (new, pure): `stateOf(word, tempC)` turns Rain, Drizzle, Storm or Wet roads into wet (ice at 1 °C or
  colder), Snow into ice, Dry or Fog into dry, and anything unknown into null. `road(state)` gives the braking and the
  corner-speed share; `line(state)` is what the co-driver says.
- web/note_timing.js `setRoad({ decelMps2, apexK })`: braking at 2.5 m/s² wet and 1.5 icy instead of 3.4 (0.35 g), and
  corner speeds × √0.7 wet and × √0.35 icy. Every lead, wake and needs-brake check uses it, so the notes come earlier.
  `setRoad(null)` restores the dry road; that happens at each drive's start and end.
- web/cockpit.js `noteWet()` on each live frame: when the plate's data is new, set the road and, the first time it turns
  wet or icy, say "Wet roads. Notes come earlier." or "Ice risk. Notes come earlier. Go gently." It goes in the quiet
  slot (sayQuietLine), with a toast. Unknown weather keeps whatever was known. Nothing new is sent to anyone.
- Not changed: the Driver Score's sane limit, which stays the dry one (see CALL SHEET).
- Tests: tests/test_wet_roads.py (states, including the owner's 2026-11-04 rainy day; leads get longer and come back);
  e2e "wet roads: rain where you are…" (said once, no extra request, a longer lead).
- Next: another roam item.

# CALL SHEET
## 2026-11-13 (roam-a wet roads): wet roads change when notes are read, not how drives are scored (claude/project-thread-h7xxmf)

- Only the note timing changes on a wet or icy road. The Driver Score and the live clean-corner count still judge
  against the dry sane limit, so drives on different days stay comparable. A wet day's score already reads lower when
  you drive gently. Undo: drop the `noteWet()` calls in cockpit.js (or `setRoad` in note_timing.js).
- The numbers are rules of thumb: wet grip about 70 % of dry, ice about 35 %, braking 0.25 g wet and 0.15 g on ice.
  They only make the notes earlier, never later, and setRoad cannot make the road better than dry.
- It reuses the plate's request instead of asking again, so the privacy page and APP_REVIEW need no change: the same
  position rounded to about 1 km, every 20 minutes or 5 km.
