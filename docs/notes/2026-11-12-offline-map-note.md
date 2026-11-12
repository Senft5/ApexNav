# STATE
## Session 2026-11-12 (offline): the main map says when it has no map (claude/project-thread-g9yher)
- Checked with every request off the app refused (cold, and after one online start): the app opens, a whole drive records with its live readouts, the end card scores it and the Log has it. Reports and road feel wait and send later (already covered by e2e).
- Fixed: with no signal and no saved area the main map was a silent blank. Now one line on it says "No map here without signal. Notes and recording still work." (or "The map couldn't load." when online), gone when a base map tile draws.
- Next: in a free drive with no tiles the map shows no position arrow or trail either; worth a look.

# CALL SHEET
## 2026-11-12 (offline): a note over the blank main map (claude/project-thread-g9yher)
The drive page's map already says "Map unavailable offline" (drive_basemap.js); the main map now does the same, rather than leaving a driver in the hills staring at blank paper. It counts only base map tile failures and a style that never loaded, waits 1.5 s so a passing failure never flashes it, and never takes a tap. Undo: remove `mapNote` in web/cockpit.js and `#mapNote` in web/index.html.
