# STATE

## 2026-11-12 the quiet strip and Layers say less
- Done: the strip's quiet line no longer explains the mode. Planning reads "Route name · Quiet notes" (matches "Full notes"); driving reads "Quiet · Road" with "next corner N" when one is known, never "bumps and cameras only". Layers: Meets' line is "Public crews' meets" (it wrapped), Cameras' is "Plate and speed".
- Tests: e2e flows matching "Quiet", the strip, the co-driver's quiet line and the Layers legend pass.
- Next: keep sweeping the drive screen's status line and the shell.

# CALL SHEET

## 2026-11-12 quiet line without the mode's explanation
- What: dropped "bumps and cameras only" / "bumps, cameras" from quietLine in web/cockpit.js; "Quiet notes" when planning; two Layers lines shortened.
- Why: Nate's no-walls-of-text rule; what Quiet calls is the Notes switch's to say (vocabulary.js keeps the meaning), and the strip wrapped to two rows.
- Undo: restore the two strings in quietLine and the two <small> lines in web/index.html.
