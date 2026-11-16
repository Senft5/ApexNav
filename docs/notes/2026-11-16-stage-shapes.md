# STATE

## Stages list draws each stage's road (UI thread, 2026-11-16)
- Each row in Log, Stages now has the stage's own road shape on the left, the same 48 px thumbnail the Drives list draws for a drive. It is drawn from the stage's `geom` (up to 60 points kept when it was marked).
- A stage with no `geom` (an old or adopted one) draws nothing and keeps the old two-column row. At a larger text size the shape is hidden, as in the Drives list.
- `web/analysis_page.js` renderSegments, the `.seg-shape` / `.seg-wide` CSS in `web/analysis.html`. The e2e flow "Stages: a stage with no runs" checks for the shape.

# CALL SHEET

## A stage row shows its road, not only its name
- What: `.seg` rows get an `i.seg-shape` thumbnail from `ApexRouteThumb.svg`. The "no runs yet" line spans the text columns through a class instead of an inline style.
- Why: Nate (11-16) said menus feel like "just a list of things". The Drives list already lets you find a drive by its road's look; Stages was a column of grey name boxes.
- Undo: drop the `shape` lines in renderSegments and the `.seg-shape` CSS.
