# STATE

## 2026-11-13: no "Plain livery" line under a Plain crew's page
- Done: a Plain crew's page no longer ends with a lone "Plain livery" line for its owner. Crew-mates already saw none (2026-11-12). The owner's Edit livery is on the cover now, so the foot line only repeated what the cover shows. A crew with Factory decals, early access, or a Pro supporter still gets its line. The e2e crew page flow checks the page is title, then tabs, with no livery line for the owner.
- Next: the member sheet's Done, Report, Block row.

# CALL SHEET

## 2026-11-13: the owner of a Plain crew loses the livery foot line
- What: web/crew_page.js `liveryFoot` returns null for every Plain crew with no supporter, the owner included.
- Why: the line's reason ("above their Edit livery") went stale when Edit livery moved to the cover; alone at the foot it was clutter (Nate: clean where features meet).
- Undo: put `!c.is_owner &&` back in the early return.
