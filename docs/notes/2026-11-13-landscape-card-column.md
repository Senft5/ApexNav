# STATE

## 2026-11-13 Landscape: the route card is a column and the route shows beside it (claude/project-thread-5sbga7)
- Done: on a phone in landscape a planned route's card filled the whole map column, so the route it describes was out of sight until the card went down. The card is now a column on the left (at most 400 px, half the screen) and the map beside it shows the route, fitted right of the card. The desk's Where to? column gets the same fit (its route no longer lies under the column).
- Tests: e2e "landscape: a planned route is its card alone…" now also checks the column and that every point of the route projects right of it; "the chosen route stays whole", "a loop fills the map", "drive ended", "landscape mount", "desk", "safe areas (landscape)", "plan flow (a, d)".
- Next: the profile's empty "Heights --" room is tall in the narrow column; keep sweeping landscape.

# CALL SHEET

## 2026-11-13 a sheet that is a column clears its side of the map in route fits
- What: index.html landscape block `.plan.open.routed { right: auto; width: min(400px, 52%) }`; cockpit.js sideCover() (the px of the map an open plan column covers on the left), used as fitInView's left padding and to make routeBottom only the safe area plus 24 px.
- Why: the panel round's DA-2 rule ("the chosen route stays whole on screen") only knew sheets across the map's foot.
- Undo: delete the CSS line and sideCover's two uses.
