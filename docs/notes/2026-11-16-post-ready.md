# STATE

## 2026-11-16 A drive, ready to post
- Done: the drive's card has one Post key, which opens the Post sheet ready (`drive_posts.js` compose with `ready`): "Nice drive. Post it?", the road with Score and distance, the name pre-filled and editable, the crew drive's crew and who came, convoy friends tapped in on a post to friends, Post focused, Not now. A tap outside the sheet now settles it as Not now (it used to leave the promise hanging). e2e "drive posts: Post on a scored drive's card…", "post media…", "a drive posted with no signal…".
- Next: the best corner as the post's picture when the drive was filmed (best_clip.js), then split the crew settings sheet into Manage crew and Your settings.

# CALL SHEET

## 2026-11-16 Post opens the ready sheet instead of posting in one tap
- What: the drive card's "Post to friends" (one tap, Undo) and its ··· are now one "Post" key that opens the pre-filled sheet.
- Why: Nate's approved mockup ("Nice drive. Post it?"); one sheet shows what will be posted, to whom and with whom, before it goes, and posting is still one more tap.
- Undo: restore the `endPost` one-tap handler and `#endPostMore` in web/index.html and web/cockpit.js from before this PR.

## 2026-11-16 The Feed's pick survives a redraw
- What: the full Feed's All / Friends / crew pick is kept by the Feed's owner (`drive_posts.js` mount), so a redraw of the Social tab no longer puts it back to All; a crew picked and since left falls back to All.
- Why: the Social tab redraws when what it shows changes; a pick made just before a redraw was lost (the intermittent CI failure in "the full Feed picks whose posts…", reported from the analysis thread).
- Undo: start `full()` at `only = ''` again.
