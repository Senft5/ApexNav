# STATE

## 2026-11-13 Log: Score over time fits the Scores; corner records say /100 (free roamer B)
- Walkthrough of the Log on a phone with three drives scored 811 to 836: Score over time ran its axis from 0 to 1000 in heavy black lines, so the three drives were one flat line in a tall empty box. Under it, Your records put a corner record "100" beside a road's "814" with nothing saying one is out of 100 and the other out of 1000.
- Done: web/analysis_page.js renderHistory starts the axis at a round number under the lowest Score (steps of 50, 100 or 250 up to 1000) and draws the grid in the theme's hairline colour; a corner record reads "100/100" (#recordsTable .score small in web/analysis.html). The e2e "Your driving: the profile" flow checks both.
- Next: keep walking on a phone.

# CALL SHEET

## 2026-11-13 Score axis and /100 on corner records (free roamer B)
- What: Score over time's axis fits the Scores (floor of the lowest Score minus 50, to 250s; 1000 on top); corner records carry /100.
- Why: a 0 to 1000 axis hid every change between drives; the top stays 1000 so a Score is never stretched to look perfect.
- Undo: restore the fixed [0, 250, 500, 750, 1000] grid and `C.rule` stroke in renderHistory, drop the `<small>/100</small>` and its CSS, and the two e2e checks.
