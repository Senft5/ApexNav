# STATE

## 2026-11-16 Along-the-route stamps are small marks
- Done: a planned route's viewpoints, cafés, fuel stops, waterfalls and chargers show as a small disc with the place's mark (peak, cup, pump, drop, bolt) instead of a boxed word (VIEW, CAFÉ). A stamp that names its place (the drive's next fuel stop, a viewpoint close in) is a pill with the mark and the name. Find nearby's own pins keep their names.
- Next: the route card's extra lines; Ways to go (project files ui-thread/screen-inventory.md).

# CALL SHEET

## 2026-11-16 Map stamps: marks, not words
- What: index.html `.poi-pin:not(.nearby-pin)` is a 24 px disc whose `::before` is the kind's mark (a mask, `--poi-ico`, in `--poi-ink`); `.poi-named` makes it a pill. cockpit.js toggles `.poi-named` where a stamp's text becomes a name (the drive's next fuel, a viewpoint at zoom 15+). Text and aria-labels unchanged, so declutter and the e2e read them as before.
- Why: Nate, 2026-11-16: the map is cluttered; a route preview carried seven boxed words.
- Undo: delete the "an along-the-route stamp is its mark" block and the two `poi-named` toggles.
