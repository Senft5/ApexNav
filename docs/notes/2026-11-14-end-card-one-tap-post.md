# STATE

## 2026-11-14 drive-end card posts to friends in one tap (claude/project-thread-5sbga7)
- Done: a signed-in member's drive-end card leads its actions with a solid "Post to friends" key. One tap posts the drive (score, road, distance) to the Friends feed with no sheet; the key then reads "Posted to friends" and a toast offers Undo for 8 s, which deletes the post (DELETE /api/posts/:id). The ··· key beside it opens the old sheet for a caption or a crew. The quiet keys (again, stage, done) sit in one row.
- Fixed: toasts were hidden behind the end card (toast z-index 6 inside the stage, overlays at 40); with the end card shown the toast now sits above it.
- Tests: e2e drive posts flow (one tap sends crew_id null and the score with no sheet, Undo deletes, ··· opens the crew sheet).
- Next: the best corner clip on the end card needs the drive-video thread's clip pipeline (the dashcam lines up only on the Log page today).

# CALL SHEET

## 2026-11-14 one tap posts to friends, Undo instead of a confirm sheet
- What: drivePosts.post(d) posts straight to friends; drivePosts.remove(id) takes it back from the toast. The caption and crew sheet moved behind the ··· key.
- Why: every drive ends on this card, and a sheet before every share is the friction that stops people posting. Undo keeps the one tap safe, the way Instagram and Strava let you take a post back.
- Undo: make #endPost call drivePosts.compose(d) again and drop #endPostMore.
