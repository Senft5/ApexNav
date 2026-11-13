# STATE

## 2026-11-12 Replay with no map: the note clears the Replay plate (free roamer B)
- Walkthrough of Replay from a drive's page on a phone with no base map: "The map couldn't load. Notes and recording still work." sat 28% down the short map band, right over the "Replay · demo ×" plate.
- Done: outside idle (replaying or driving) the note sits at the top of the map band (the place plate is away then) and gives way while a hazard plate shows (web/index.html CSS). New e2e flow "a replay with no map" at a phone's size fails on main and passes here.
- Next: keep walking the replay screen (its controls) on a phone.

# CALL SHEET

## 2026-11-12 Map note at the top outside idle (free roamer B)
- What: `#app:not(.idle) .map-note { top: 12px; }` and the note hidden while a hazard plate shows.
- Why: in a replay or a drive the map is a short band, and 28% down overlapped the mode plate; a hazard matters more than a missing base map.
- Undo: drop the two CSS rules after `.map-note[hidden]` in web/index.html and the e2e flow.
