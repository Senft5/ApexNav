# STATE

## A clip or a photo on a drive post (2026-11-13)
A driver can add a photo to a drive post from the Post sheet. Friends see it on the post in the Feed. A corner clip
plays muted and looping there, and a tap stops it. `backend/src/post_media.ts`: `PUT /api/posts/:id/media` (the
author only; mp4 or webm up to 8 MB, JPEG up to 3 MB, bytes sniffed) and `GET` (exactly who sees the post).
The bytes are in R2 `MEDIA` (`apexnav-media`, previews `apexnav-media-preview`) under `post/<id>`.
Migration 0061 adds `drive_posts.media`. The bytes go with the post, with the owner's remove, and on Delete account.
`web/drive_posts.js`: the card's media (fetched when near the screen), Add a photo, and `compose(d)` taking `d.media`
({ blob, mime, label }) for the analysis thread's corner clips.
Tests: backend/test/post_media.test.ts (3), e2e "post media: …".
Next: the drive's page (analysis.html) hands a corner clip to `compose` through `page.post(blob, meta)`, a hook it
asked for. A post deleted by a crew's cascade leaves its bytes, which are never served (GET checks the row). A sweep can list `post/` later.

# CALL SHEET

## Media in R2, its description in one column (2026-11-13)
What: one clip or photo per post. The bytes go in R2, and `drive_posts.media` holds JSON {kind, mime, bytes, label}.
Why: the feed knows a post has media without one R2 call per post. KV is near its write cap and too small for clips.
Undo: drop the column (SQLite 3.35+ `ALTER TABLE … DROP COLUMN`), and delete `post/` from the bucket.

## A post with media doesn't wait for signal (2026-11-14)
What: with no signal, a post carrying a photo or clip keeps its sheet open ("Couldn't post it. Check signal.") instead of going to the outbox.
Why: the outbox (outbox.js) keeps JSON bodies in localStorage, which can't hold the clip's or photo's bytes.
Undo: drop `&& !media` from the outbox test in `compose` (the post would then go up later without its media).
