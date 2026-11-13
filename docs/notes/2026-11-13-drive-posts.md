# STATE

## Drive posts and the Feed (2026-11-13, big bet #4)
A member posts a scored drive from its end card (Post, the solid key) to friends or a crew: name, day, length, Score,
roads, a caption and a line with both ends cut. People → Friends shows a Feed (newest three, See all) with one-tap kudos
and comments; Report, Block and Delete sit behind ···. Server `backend/src/drive_posts.ts` (migration 0059, applied to
both DBs 2026-11-13 on Nate's go), web `web/drive_posts.js`, tests `backend/test/drive_posts.test.ts`,
`tests/test_drive_posts.py`, e2e "drive posts: …".
Next: photos on a post, stages on the card, push for kudos and comments (with the APNs work in #665 and the push
server stash), and a Feed entry point on the crew page.

# CALL SHEET

## Post is the end card's solid key for members (2026-11-13)
What: for a signed-in member with a scored drive, Post is solid and Share card is a plain key beside it. Both are there
from the first frame (U-118), and Post waits for the score.
Why: the post is the social loop (big bet #4). Share card makes a picture for other apps and stays one tap away.
Undo: in cockpit.js endCardOpen and endCardScored, drop the `member`/`posting` toggles of `endShare`'s solid class.

## The Feed sits on People → Friends under For you, three posts deep (2026-11-13)
What: three cards, then See all opens the whole Feed in a side sheet. There is no new tab.
Why: Nate's rule against clutter, and People is where friends already are. A fifth tab would crowd the bar.
Undo: drop the `drivePosts.section` block in renderAccount.

## No photos on posts yet (2026-11-13)
What: v1 posts carry no photo.
Why: photos.kind has a CHECK constraint, so adding 'drive' means rebuilding the table, which is a migration of its own.
Undo: n/a. Next step: rebuild photos with kind 'drive' and a POST_SEEN case in PHOTO_SEEN.
