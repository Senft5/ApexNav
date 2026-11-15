# STATE

## 2026-11-15 The Post sheet knows the crew drive you were on
- Done: on a day you were marked at one of a crew's drives, the Post sheet (··· beside Post on a drive's card) picks that crew by itself and shows "With @bob and @cara", the line the post will carry. If you pick Friends, the names go. Your own pick always wins, even when it comes before the answer. `GET /api/feed/with?day=YYYY-MM-DD` (backend/src/drive_posts.ts `feedWith`): the crew drives you were marked at that day, in crews you are still in, with who else came (five at most, never across a block, never a cancelled drive). No migration. Tests: vitest "/api/feed/with", e2e "drive posts: Post on a scored drive's card".
- Next: the one-tap "Post to friends" key on the drive's card could read "Post to Ridge Runners" on such a day.

# CALL SHEET

## 2026-11-15 The crew is picked only in the sheet, not on the one-tap key
- What: the one-tap key on the drive's card still posts to friends. Only the sheet behind ··· picks the crew. Why: a one-tap key that changes where it posts, depending on a reply the driver can't see, could send a post somewhere they didn't expect. The sheet shows the pick before Post. Undo: drop the `/api/feed/with` fetch in drive_posts.js compose().
