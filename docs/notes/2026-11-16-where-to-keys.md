# STATE

## Where to? keys: tiles, not pills (UI thread, 2026-11-16)
- In the Roadbook look, each key under Where to? (Best roads nearby, Gas, Coffee, Food, Parking) drew a grey chip pill behind its outlined square. The key is now just its rounded raised tile and its word; Best roads nearby stays solid ink. `web/system.css`.

# CALL SHEET

## The Where to? keys drop the chip fill
- What: `.chip.rkey` takes no chip fill or radius in the Roadbook look; its `<i>` tile is the raised rounded card, with no outline.
- Why: two shapes stacked (a square outline on a grey pill) read as a rendering bug.
- Undo: delete the three `rkey` rules above `.loop-suggest svg` in `web/system.css`.

## Before your first drive says "full drive"
- What: the permission sheet's note reads "Your full drive stays on this phone." (was "Your drive stays on this phone."), and the Mount line is cut to "in a holder, any way up".
- Why: since 11-15 an anonymous, trimmed copy uploads by default (Help improve Vetta roads), so "your drive stays" overpromised; the full drive is what stays. The mount sets itself up without the driver doing anything, so the sheet needn't explain it.
- Undo: restore both strings in `web/index.html`, `web/cockpit.js` (`permNote`) and `tests/test_end_reveal.py`.
