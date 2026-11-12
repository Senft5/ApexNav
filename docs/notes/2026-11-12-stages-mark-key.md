# STATE

## 2026-11-12 Stages: the empty page's key opens the marker (free roamer B)
- Walkthrough of the Log's Stages tab on a phone with one drive: "Pick a drive to mark one from" sent you to the Drives list, and nothing there or on the drive's page said what to do next (Mark a stage sits behind the drive page's "⋯").
- Done: the key reads "Mark a stage" and opens the new-stage marker right on the Stages page, on your latest drive, scrolled into view; the marker's own picker changes the drive (web/analysis_page.js openMarker, shared with the drive-ended card's route). tests/test_log_first_page.py and a new e2e flow ("Stages with no stage yet") hold it.
- Also: e2e "plan flow (e, f)" failed now and then on CI (#578, #590: the card held 40 px from where it was measured). The test measured the card and started its scroll timer before the tap, so on a slow runner the scroll landed first. Both now start at the finger's pointerdown; 6 of 6 local runs pass (it failed 1 of 3 before).
- Next: keep walking the Log (Compare) on a phone.

# CALL SHEET

## 2026-11-12 Empty Stages key opens the marker in place (free roamer B)
- What: on Stages with no stage and at least one drive, "Mark a stage" opens the marker on the latest drive instead of linking to the Drives list.
- Why: the old key led to a list with no next step; the owner's rule that every feature be clean and intuitive.
- Undo: restore the `<a ... href="analysis.html?tab=log">Pick a drive to mark one from</a>` key in renderSegments, drop the segMarkGo listener, and revert tests/test_log_first_page.py and the e2e flow.
