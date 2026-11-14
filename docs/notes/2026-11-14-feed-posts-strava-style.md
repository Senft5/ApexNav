# STATE

## 2026-11-14 Friends feed posts read like Strava's (claude/project-thread-5sbga7)
- Done: each post on People → Friends drops its ink box for a rule between posts. It reads top to bottom: who and when, the drive's name, the caption, the numbers in one row (Vetta Score, Distance; unknown stays --), the road drawn full width on a well with a ringed start and a red finish dot (as on the end card), then the roads and Kudos / Comment. ··· is a 44 pt key, not an underlined link. The stray short rule over "Feed" and the rule inside the post above its title are gone.
- Tests: e2e drive posts flow (stats row, line full width under it with both ends, no box).
- Next: a real map tile behind the line when it's cheap to render.

# CALL SHEET

## 2026-11-14 feed posts lose their box and lead with a stats row
- What: drive_posts.js card(): .feed-stats row, .feed-line at 2:1 on var(--well) with circle.go and circle.end; .feed-card has only a top rule.
- Why: the old card put a 34 px score beside a 96 px squiggle inside a box, so a post read as a form. Strava, Instagram and every major feed let a post run edge to edge, show the numbers in one row and give the route the width.
- Undo: revert the STYLE block and the card() body in web/drive_posts.js.
