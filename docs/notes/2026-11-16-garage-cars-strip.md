# STATE

## 2026-11-16 Your cars sit under the Garage profile's head
- Done: the Garage profile shows your cars as a horizontal strip right under the head (screen inventory, Garage row "Your cars"): cover photo or a car mark, the name, Daily; a tap opens the car's build thread, or scrolls to its card below and lights it; the last tile, dashed, is Add a car (the section's own Add a car key goes, so there is one). No cars: no strip, the empty bay stays. e2e "Garage → You is your profile" checks it.
- Done: a post on its own (`drive_posts.js` `open`): its shape while loading (no "Loading…"), "Couldn't load the post. Check signal." with Try again, "This post is gone." for one taken down; no comments is one line; a long press on a comment opens its keys (Delete now a danger key); after Send the box keeps focus and Send waits for words. e2e: a new "a post that can not load" flow; "drive posts: Post on a scored…" checks the long press and the focus.
- Next: Edit post with the post sheet's fields; then the inventory's Friends rows (a friend's row opens their profile).

# CALL SHEET

## 2026-11-16 A car with no build thread scrolls to its card instead of opening one
- What: the inventory says a car opens its build page. A car with a build thread opens it; one without scrolls to its card (Edit, the share switch, Start a build thread) rather than starting a thread on a tap.
- Why: starting a build thread is a post friends see; a tap meant to look at your car shouldn't create one.
- Undo: in `web/garage_ui.js` `fillStrip`, call `page.builds.start(c, render)` in the else branch.
