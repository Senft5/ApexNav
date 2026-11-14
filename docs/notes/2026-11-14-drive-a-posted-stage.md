# STATE

## 2026-11-14 A stage on a drive post opens as its own route

- **Done:** a stage row under a drive post (for example "Skyway summit 801") is now a key when the post can show where
  the stage lies. A tap lays a route along just that stretch of the friend's line, named for the stage. Rows the server
  couldn't place stay plain text.
  - `web/analysis_client.js` `stagesOn` adds each stage's `ends` ([lat0, lon0, lat1, lon1], 5 decimals); the end card's
    one-tap Post and the Post sheet send them.
  - `backend/src/drive_posts.ts` keeps a stage's ends only when both lie within `ON_LINE_M` (60 m) of the line as kept,
    with its 500 m ends already cut. So no point the line hides (near home) ever reaches a friend. No new column: stages
    are already JSON.
  - `web/drive_posts.js` `stretch(pts, ends)` cuts the line between the points nearest the ends, and `throughPoints(…, 6)`
    routes it the same way as the post's Drive it.
  - Tests: a vitest case (kept on the line; dropped in the cut ends; dropped off the line), and the e2e "drive posts:
    Drive it…" flow now taps the stage too. "drive posts: Post…" checks that the post carries the ends.
- **Active bugs:** none known.
- **Next:** keep roaming.

# CALL SHEET

## 2026-11-14 A stage's ends on a post are checked against the kept line

- **What:** the Worker drops a stage's ends unless both are within 60 m of the post's line after its ends are cut.
- **Why:** a stage can start where a drive starts (home). The line already hides its first and last 500 m, and the ends
  must never undo that.
- **Undo:** drop the `ends` field: `stagesOut` in drive_posts.ts and `ends` in analysis_client.js `stagesOn`. The rows
  go back to plain text.
