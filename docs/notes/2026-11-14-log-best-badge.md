# STATE

## 2026-11-14 The Log marks your best drive on each road

- **Done:** the Log's drive list now puts a small red "Best" over the score of your best drive on any road you have
  scored twice or more (ties go to the earlier drive, the same rule as Your records). A road driven once gets no badge,
  so the mark only appears when it means "you beat yourself here". VoiceOver hears ", your best on this road".
  - `analysis_page.js` pulls the per-road grouping out of `renderRecords` into `roadRecords` / `roadBests`, so the list
    and Your records can never disagree on which drive is the best.
  - New e2e flow "the Log marks your best drive on a road you have scored twice or more…". It fails on main.
- **Active bugs:** none known.
- **Next:** a tap on a friend's stage could open its board; Where to? results and the route Options sheet still to walk.

# CALL SHEET

## 2026-11-14 Best badge only for roads scored twice or more

- **What:** `roadBests` uses Your records' rule (two or more scored drives, by drive name) to pick the badged drive.
- **Why:** a "Best" on every single-drive road would mark nearly every row and mean nothing. One rule for both places.
- **Undo:** drop the `pb.has(d.id)` span in `renderHistory` and the `.pb` rule in analysis.html.
