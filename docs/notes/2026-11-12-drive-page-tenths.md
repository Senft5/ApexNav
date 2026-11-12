# STATE

## 2026-11-12: a drive's page says seconds to a tenth
- Done: on a drive's Log page every corner time (ideal drive, Where to find time, the corner list, the scrub readout) is to 0.1 s, and the most abrupt moments to 0.1 g/s. The ideal line is one labelled line with its sample: "Ideal drive: 0.5 s quicker · your best pass at each of 36 corners, over 2 drives".
- Next: the same analytics pass on what remains of the drive page (the repeatability rows).

# CALL SHEET

## 2026-11-12: corner times to a tenth of a second
- What: `fmtD` and the ideal gain round to 0.1 s (was 0.01 s); a sign shows only from 0.05 s, matching the gain/loss colour threshold. Lap times keep hundredths (a lap timer's convention).
- Why: the UI/UX guide's "no false precision"; phone GPS can't time a corner to a hundredth.
- Undo: `toFixed(1)` back to `toFixed(2)` in `web/drive_view.js` `fmtD` and the ideal line.
