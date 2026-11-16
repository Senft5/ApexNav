# STATE

## 2026-11-16 The Report sheet draws each hazard
- Done: the public hazard kinds in the Report sheet (Pothole, Gravel, Debris, Animal, Police, Road closed) are tiles with their own drawn mark over the word, in the hazard colour, instead of six identical warning triangles. A crew's own kinds keep the triangle. On its side the tile is shorter, with a small mark over the word.
- Next: the convoy calls above it (still words only); the explain card; the end card (project files ui-thread/screen-inventory.md).

# CALL SHEET

## 2026-11-16 Hazard kinds drawn, not all triangles
- What: cockpit.js `HZ_ICON` (inline SVG per kind) prepends a mark to each `#hzKinds` button (`.hz-drawn`, `data-kind`); index.html styles `.hz-drawn` as a 92 px column tile and drops its `::before` triangle; landscape keeps the column, smaller (a mark beside the word cut "Pothole" on CI). The button's text is still just the label, so e2e and the Undo key read it as before.
- Why: Nate, 2026-11-16, the drive screen should be calm and quick to read; six orange triangles had to be read word by word while driving.
- Undo: remove `HZ_ICON` and the `.hz-drawn` rules.
