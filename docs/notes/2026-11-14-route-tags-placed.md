# STATE

## 2026-11-14: route tags sit on their own routes, stamps step aside
- Fixed: with three routes found, the second and third time/corners tags on the plan map sat 41 and 82 px below their route (a `position: relative` on `.route-callout` overrode MapLibre's absolutely placed marker, so each tag was laid out under the ones before it). Each tag now sits just above its own point.
- The viewpoint, café and fuel stamps now count the route tags in their declutter: a stamp under a tag hides, the tag stays.
- Newly possible: telling at a glance which tag belongs to which line when routes run close together.
- e2e "route callouts" checks each tag's bottom is 6 px above its projected point (fails with the old CSS: off by 41/82 px) and no stamp shows under a tag.
- Next: keep on the next highest-impact non-social UI improvement.

# CALL SHEET

## 2026-11-14: route tags are fixed pins in the stamp declutter
- What: `declutterPois` adds each route tag as a fixed box (above its point) that never hides; only stamps step aside for it.
- Why: the tags are the plan's main control; a café stamp is the thing to lose.
- Undo: drop `tagPins` from the `concat` in `declutterPois` (web/cockpit.js).
