# STATE

## Road marks: deer and other animal crossings, horse-drawn buggies, covered bridges (2026-11-13)
- `web/road_marks.js` calls three more things the map has on a route: a mapped animal-crossing sign (ANIMAL: "Deer
  crossing", "Horse crossing", "Cattle crossing", else "Animal crossing", from the sign's animal tag), a horse-drawn
  vehicle sign (BUGGY: "Horse-drawn buggies") and a covered bridge (COVERED: "Covered bridge"). Glyphs in
  `instruments.js tulipSVG`. Tests: `tests/test_road_marks.py` (a deer sign through the real Overpass parser).
- Next: keep roaming.

# CALL SHEET

## Rural marks are called whenever the notes are awake, not only at dusk (2026-11-13)
- What: a deer-crossing sign is called on every pass with the notes on, any hour.
- Why: the sign is there all day and a driver sees it all day; marks are only spoken in spirited mode (not cruise), so it
  adds one short call per sign, and deer on Ohio and Kentucky back roads are not only a dusk thing.
- Undo: drop `animal_crossing` (and `buggy`, `covered_bridge`) from `KINDS` and `marksOf` in `road_marks.js`.
