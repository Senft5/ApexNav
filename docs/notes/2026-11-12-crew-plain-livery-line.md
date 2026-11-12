# STATE

## 2026-11-12 Crew page: no "Plain livery" line for crew-mates (free roamer B)
- Walkthrough of a crew page as a member (not the owner): the run card, members and meeting points read well. At the foot sat a lone grey "Plain livery", which told a crew-mate nothing and gave them nothing to press.
- Done: on a Plain crew, a member who isn't a Pro supporter sees no livery line. The owner still sees it, and a supporter still gets Your Decals; a dressed (Factory) crew still says who dressed it. Checked in e2e flow "crew drives: an upcoming drive…".
- Next: the crew page's top row holds only the gear key for a one-crew member, about 80 px of empty band above the cover art; it could sit on the art.

# CALL SHEET

## 2026-11-12 Hide the Plain livery line from crew-mates (free roamer B)
- What: crew_page.js liveryFoot returns nothing for a non-owner, non-supporter on a Plain, ungranted crew.
- Why: the owner's standing rule (2026-11-12) to cut clutter and text that does nothing; UX-06 already said Plain says nothing it lacks.
- Undo: drop the early `return null` in liveryFoot (web/crew_page.js) and the check in the crew drives flow.
