# STATE
## 2026-11-14 Post kudos and comments in For you
- Done: For you (People → Friends) now lists kudos and comments on your drive posts, and a new comment after yours on a
  post you commented on, one row per post ("@bob and 2 others gave kudos to Tellico climb", Open opens the post).
  The earlier commenters also get a push ("@cara also commented on @alice's drive."). No migration.
- Next: your own posts on Garage → You (agreed with the UI thread, which stays off social profiles and the Feed).

# CALL SHEET
## 2026-11-14 Who hears about a comment
- What: a comment tells the post's author and everyone who commented on it before, if they can still see the post and
  aren't blocked either way with the commenter. For you shows only comments after your own latest one.
- Why: that's what every social app does, and it's how a thread under a post turns into a conversation.
- Undo: drop the second half of `afterPostComment` in backend/src/push.ts, and the second query in backend/src/inbox.ts.
