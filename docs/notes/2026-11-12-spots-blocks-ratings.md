# STATE
## Session 2026-11-12 (security pass, Spots): blocks hide spots; fresh accounts' stars don't count (claude/project-thread-4lms1f)
- backend/src/highlights.ts `highlightList`: drops spots whose author you blocked or who blocked you (your own always
  show), and spots you reported (open). The score and rating count use only ratings from members who pass reportedSql's
  gate (invited, or a member 7 days); a fresh account's own stars still come back as `my_stars`.
- Tests: backend/test/highlights.test.ts (+1). APP_REVIEW.md 1.2 updated.
- Next in the pass: a per-session read limit on member GETs (scraping handles, crews near a point), and the crews-near
  discovery grid (crewDiscover) against walking the map cell by cell.

# CALL SHEET
## 2026-11-12 (security pass, Spots): a blocked person's spots leave your map, and new accounts can't rate a spot up or down (claude/project-thread-4lms1f)
Spots near you showed every member's spot, even one from someone you blocked, and a spot's stars counted every account,
so a few accounts made a minute ago could push one to the top or bury it. Now a spot from someone you blocked (or who
blocked you), or one you reported, no longer shows to you, and a spot's score counts a rating once the rater was invited
or has been a member a week, as the three-report rule does. Undo: revert the two clauses in highlights.ts highlightList.
