# STATE

## 2026-11-12 Compare with nothing to compare (free roamer B)
- Walkthrough of Compare (a drive's "⋯") on a phone with one drive: both pickers showed the same drive, then "Pick two different drives." over three empty panels (Road, Gap along the road, Corner by corner), with a legend in m/s and "÷".
- Done: with one drive, the page is one line ("Compare needs two drives. Drive this road again and it lands here."); with the same drive picked twice, the pickers and that line only. The empty panels are hidden until a comparison draws them (web/analysis_page.js renderCompare). The table's legend is shorter and in words. New e2e flow "Compare with a single drive".
- Next: keep walking the Log on a phone (a stage's page with runs).

# CALL SHEET

## 2026-11-12 Compare hides its empty panels (free roamer B)
- What: renderCompare hides #cmpRoad, #cmpCorners (and the pickers, with a single drive) when there is nothing to compare; the Corner by corner legend reworded without units.
- Why: three empty panels under one note read as broken; the owner's rule against clutter and walls of text.
- Undo: drop the none() helper and the hidden toggles in renderCompare, the two ids in web/analysis.html, and restore the old legend.
