# STATE

## "Twisty section ahead." on a free drive (V-16, 2026-11-15)
- `web/corners_ahead.js ahead(events, cursorM, quietM, endM)`: the first twisty section on the road ahead (6+ corners
  within 500 m of each other over 1 km+) after 2 km or more without a corner, counting `quietM`, how far the car has
  driven since its last corner. `tracker()` keeps that distance across the road ahead's rebuilds (each starts at the car).
- A section that runs on past the end of the road ahead (~2.5 km) is said as "Twisty section ahead." with no count, as its
  corners aren't all known; that line has its clip (`frag:twisty`, voice_lines.js compose).
- `cockpit.js`: through the same quiet slot as the planned route's (`cornersSay`), about 30 s out, not in Quiet notes,
  once per place (within 150 m, `free.twistySaid`), reset with the drive.
- Tests: `tests/test_corners_ahead.py` (free drive), `tests/test_voice_coverage.py`; e2e "a twisty section on a free
  drive…" (3/3, and it fails with the free-drive block off).
- The startup budget (e2e, 3.6 MB of script before the map is ready) was 1.5 KB over with this, so the four quiet-line
  modules (sun_ahead, briefing, corners_ahead, along_ahead, ~16 KB) are now a lazy group, `ahead` (web/lazy.js): loaded
  once the map is idle after the launch, or when a drive starts. Each was already behind its `window.Apex*` check.
- Next: keep roaming.

# CALL SHEET

## The drive's quiet-line modules load lazily (2026-11-15)
- What: sun_ahead.js, briefing.js, corners_ahead.js and along_ahead.js left index.html for lazy.js group `ahead`.
- Why: the launch budget was full (3.6 MB); these only speak during a drive, and the idle warm-up loads them seconds
  after launch anyway. A drive started in the first seconds may miss its briefing until they land.
- Undo: put the four script tags back in index.html before road_marks.js, drop the group and its two loads in cockpit.js.
