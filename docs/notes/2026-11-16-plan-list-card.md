# STATE

## 2026-11-16 Where to?'s list is one card of rows with marks
- Done: under Where to?, Loop from here, Spots near you, Time attack, Roadbooks near you and Options are one card of rows, each led by its own mark on an ink tile (as Apple Maps and Settings lead rows), instead of a run of hairline rows.
- Next: "Tap the map" as a quieter hint; the route card's extra lines (project files ui-thread/screen-inventory.md).

# CALL SHEET

## 2026-11-16 Plan list rows get marks on one card
- What: CSS only (index.html, above `.plan.typing`): `#planBody .plan-list` is a well card; rows lose their own rules and get an inset hairline; each row's `::before` is a 30 px ink tile with its mark cut out by a mask (`--row-ico`, an inline SVG), so it takes each look's ink and card.
- Why: Nate, 2026-11-16: menus are "always just kind of a list of things"; this sheet is the first one every drive opens.
- Undo: delete the "The plan sheet's list is one card of rows" block.
