# STATE
## Session 2026-11-14 (rider trunks): Fun and Long way drive the two-lane mountain US routes OSM tags trunk (claude/project-thread-39xbx9)
- Done: web/graph_router.js hwyOf: a two-way trunk (no one-way carriageways, not a link) whose road, by its name across the view, has K.TRUNK_FUN_KM (1.5) corner points a km or more is not a highway at Fun and Long way. The Snake (US 421, Mountain City to Shady Valley) went from 0 to 0.77 at Fun, 46 min instead of 60. Cincinnati's two-way trunks (US 127, US 27, the AA Highway: 0 to 0.25 a km) stay highways. tools/famous_roads.js reads The Snake by its OSM names (Shady Street, Daniel Boone Trail).
- Next: Back of the Dragon at Fun (0.45: leaves VA 16 for forest roads), the Blue Ridge Parkway at Fun (0.32: US 221 has more corners).

# CALL SHEET
## 2026-11-14 (rider trunks): a two-lane trunk that bends is not a highway (claude/project-thread-39xbx9)
The owner's rule (2026-11-08) is "fun should never go on the highway"; across the lower 48 OSM tags many two-lane mountain US routes trunk, so the rule kept Fun off The Snake and its like. A divided trunk, a trunk link, a straight two-way trunk, motorways and expressways are still highways. Undo: hwyOf back to marking every class <= trunk (or K.TRUNK_FUN_KM = Infinity).
