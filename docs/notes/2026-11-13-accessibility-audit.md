# STATE

## 2026-11-13: Apple's accessibility audit on every tab
- AppTourTests.testAccessibilityAudit runs XCUIApplication.performAccessibilityAudit (the Accessibility Inspector checks: labels, contrast, hit regions, Dynamic Type, clipped text, traits) on Map, Log, People and Garage, at the default text size and at the largest accessibility size. Every issue is one `A11Y-AUDIT tab · size · type · element: what` line in the log and in the `accessibility-audit` attachment. It runs in the App tour recording workflow (by hand), not on pull requests, because the first list is expected to be long.
- The tour and keyboard tests still asked for a "Crew" tab, which has been People since late October, so they skipped that tab.
- Next: run the workflow and fix what it lists, then consider moving the audit to pull requests once it passes (IDEAS U-15, LAUNCH.md section 3).

# CALL SHEET

## 2026-11-13: audit in the by-hand workflow first
- What: the audit test is skipped without APEX_TOUR=1, so simulator-tests on pull requests don't run it yet.
- Why: an unknown number of findings would turn every PR red before any are fixed.
- Undo: remove the test and its workflow step.
