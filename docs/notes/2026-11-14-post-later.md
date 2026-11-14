# STATE

## 2026-11-14: A drive posted with no signal goes up later
- Done: Post on the drive's card with no signal (or the server down) keeps the post in the outbox (`web/outbox.js`, as hazard reports are) and closes the sheet: "No signal. Your post goes up when you have one." It goes when the connection is back, and the toast now says "Sent what waited for signal." for anything the outbox sent. A post the server refuses for the day (429, past ten) is dropped then (`capped`) instead of holding hazard reports up behind it. Tests: tests/test_outbox.py, e2e "a drive posted with no signal…".
- Next: none here.

# CALL SHEET

## 2026-11-14: A queued post counts as posted on the card
- What: the card's key reads "Posted" once the post is queued, and the toast says it goes up with signal.
- Why: the end of a mountain drive is where there's no signal; making the driver come back to post again loses the caption and the moment. The outbox drops it after 24 h, like a hazard report.
- Undo: drop `later` from the drive posts mount in web/cockpit.js; drive_posts.js then says "Couldn't post it. Check signal." as before.
