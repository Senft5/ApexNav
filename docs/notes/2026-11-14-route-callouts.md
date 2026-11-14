# STATE

## 2026-11-14 Route choices tagged on the map (claude/project-thread-5sbga7)
- Done: when a plan offers more than one route, each one gets a small tag on the map with its time and corners ("7 min / 5 corners"). The tag sits where that route runs apart from the others, as Apple and Google Maps do. The picked route's tag is filled. A tap on another tag takes that route, like a swipe of the card or a tap on its faint line. The plan's camera fit now frames the other routes' tags too, so none sit off screen. Tags go when the drive starts or a single route is shown. A route that never leaves another gets no tag, since it would sit on the other's.
- Tests: tests/test_route_callouts.py (where the tag sits, no tag for a duplicate, time and corners, unknown stays "--", one route gives none). e2e "route callouts" plans to Maryville, checks one filled tag that matches the card, taps another and checks the card follows, then Start clears them.

# CALL SHEET

## 2026-11-14 Route tags as HTML markers, and the fit includes them
- What: web/route_callouts.js picks a spot per route (20-80 % of its length, farthest from the others, none under 40 m apart). cockpit.js paintCallouts draws them as maplibregl Markers (buttons with labels for VoiceOver), and fitPlannedRoute adds the tag spots to its bounds.
- Why: the faint dashed lines alone didn't say what each route costs; the card showed one route at a time. Markers stay tappable and readable at any text size, which a symbol layer doesn't give.
- Undo: drop the paintCallouts() call in paintAlternates and the calloutTags line in fitPlannedRoute.
