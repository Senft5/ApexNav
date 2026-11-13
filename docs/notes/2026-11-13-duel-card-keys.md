# STATE

## 2026-11-13: a duel card has one key
- Done: an on duel card on People shows **Drive it** as its one key. Under it, **Show my Scores to @friend** (or Share my times) and **Call it off** sit together as links on one line. Before, there were two boxed keys of different heights, and Call it off was stranded on a line by itself. web/duels.js groups two or more links into one row, so they wrap together. The e2e duels flow checks for one key and links that share a line.
- Next: keep looking at the social cards for stray keys and gaps.

# CALL SHEET

## 2026-11-13: Show my Scores is a link on the duel card
- What: the share key in web/duels.js is now a `linkbtn`, and the links share one `.row`.
- Why: one clear action per card (Nate: social as easy as any major app). Sharing is on by default now, so this key shows up less and is secondary anyway.
- Undo: make it `ink-btn` again and drop the links row.
