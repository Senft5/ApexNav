# STATE

## Convoy calls drawn like the public report (UI thread, 2026-11-16)
- A convoy leader's calls (Bump, Gravel, Debris, Animal, Police, Stopped car, Regroup here), on top of the Report sheet and in the convoy sheet, were words-only keys above the drawn public kinds. Each now has its mark over its word, drawn from the same set (`window.ApexHazardIcons` in `web/cockpit.js`), with new marks for a bump, a stopped car and a regroup flag. `web/convoy_ui.js` `callsBox`. The words, labels and order are unchanged.
- Next: the drive page (with the analysis thread's words).

# CALL SHEET

## One mark set for the public report and the convoy's calls
- What: cockpit.js publishes its hazard marks as `window.ApexHazardIcons` (plus bump, stopped, regroup); convoy_ui.js marks each call with it, and falls back to words alone if it is missing.
- Why: the sheet showed two grids of the same kinds, one drawn and one not; a glance should find Gravel the same way in both.
- Undo: drop `mark()` in `callsBox` and the `ApexHazardIcons` lines.
