# STATE

## 2026-11-12 Crew page: no "Plain livery" line for crew-mates (free roamer B)
- Walkthrough of a crew page as a member (not the owner): the run card, members and meeting points read well. At the foot sat a lone grey "Plain livery", which told a crew-mate nothing and gave them nothing to press.
- Done: on a Plain crew, a member who isn't a Pro supporter sees no livery line. The owner still sees it, and a supporter still gets Your Decals; a dressed (Factory) crew still says who dressed it. Checked in e2e flow "crew drives: an upcoming drive…".
- Also done: in one crew, the head row held only the gear key, a band of about 55 px above the cover. The gear now sits on the cover's top-left corner, level with the owner's Edit livery on the right (e2e checks it is on the cover and clear of Edit livery).
- Next: keep walking the social screens (the Board tab, a convoy from People).

# CALL SHEET

## 2026-11-12 Hide the Plain livery line from crew-mates (free roamer B)
- What: crew_page.js liveryFoot returns nothing for a non-owner, non-supporter on a Plain, ungranted crew.
- Why: the owner's standing rule (2026-11-12) to cut clutter and text that does nothing; UX-06 already said Plain says nothing it lacks.
- Undo: drop the early `return null` in liveryFoot (web/crew_page.js) and the check in the crew drives flow.

## 2026-11-12 One crew's gear on the cover (free roamer B)
- What: `.crew-head.solo` (web/crew_page.js style, toggled in cockpit.js openCrew) lays the gear over the cover's top-left.
- Why: a row with one 44 px key pushed the crew's face down the screen; top-left because the owner's Edit livery has the top-right.
- Undo: remove the `.crew-head.solo` rules and the `classList.toggle('solo', …)` call.
