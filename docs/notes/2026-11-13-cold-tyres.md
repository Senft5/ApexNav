# STATE
## Session 2026-11-13 (cold tyres): on a dry road at 7 °C or colder the co-driver says the tyres grip less, once a day (claude/project-thread-h7xxmf)
- Done: `ApexWetRoads.coldLine(state, tempC, tyres)` (web/wet_roads.js, tests/test_wet_roads.py): a dry road (the place plate's weather) at 7 °C or colder gives "Cold out. Tyres grip less until they warm.", or "Cold out. Summer tyres grip less in the cold." when the Garage car's tyres name a summer or track tyre; none for winter, snow, all-terrain or mud tyres (the score's own carGrip test). cockpit.js noteWet says it in the quiet slot once a drive and once a calendar day (`apex.coldSaid`). The notes keep their dry timing. e2e "cold tyres: a dry road at 4 degrees is said once".
- Next: nothing planned; the line is words only, never a grip number.

# CALL SHEET
## 2026-11-13 (cold tyres): a line only, the notes keep their timing (claude/project-thread-h7xxmf)
How much a cold tyre loses depends on the compound, which the Garage keeps as free text, so the pace-note timing is not changed (wet and ice do change it). 7 °C is the usual summer-tyre threshold. Once a day so a winter of drives isn't told every time. Undo: drop the cold block in cockpit.js noteWet.
