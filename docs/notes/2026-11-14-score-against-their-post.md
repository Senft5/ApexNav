# STATE

## 2026-11-14 Your Score against a friend's on their posted stages (free roamer B)
- Done: after Drive it on a friend's post (the whole line or one stage), the drive's end card says how you did on each of their posted stages you went over: "Skyway summit: 780, 21 under @bob's 801." It is said once, from the same segmentPass that scored theirs, matched by the stage's length along their line. Your own posts read "your posted 801".
- Code: `rivalsOf` / `rivalLine` in web/drive_posts.js, `postRival` and the `#endRival` line in web/cockpit.js and web/index.html.
- Tests: tests/test_drive_posts.py `test_rivals_and_the_end_card_line`; e2e "drive posts: after you drive a friend's posted stage" (fails on main).
- Next: the same comparison for a friend's stage you happen to drive without tapping Drive it (from the feed's stages near the drive).

# CALL SHEET

## 2026-11-14 Score only, at most two stages, kept 12 hours (free roamer B)
- What: the end card compares Scores, never times; at most two stages; the comparison waits up to 12 hours for a drive that goes over one of the stages, then is dropped. It takes the end card's first line slot.
- Why: posts carry Scores, not times (time sharing is a separate opt-in); a longer list would be a wall of text; a drive tapped in the morning and driven after lunch still counts.
- Undo: drop `postRival` in web/cockpit.js (and `rivals:` in drive_posts.js's two Drive it handlers).
