# STATE

## 2026-11-13: a route's Share panel has no Cancel of its own
- Done: on a route card, **Share** now opens and closes its panel. The panel's own Cancel is gone. It sat right under the route card's Cancel, which drops the whole route, so the screen showed two Cancels that did different things. Sharing to a friend from their profile still opens the panel fresh. The e2e shared routes flow checks there is no Cancel in the panel and that a second Share closes it.
- Next: keep looking for duplicate controls where features meet.

# CALL SHEET

## 2026-11-13: Share toggles its panel
- What: `#routeShareBtn` empties `#routeSharePick` when it is open; Send no longer has a Cancel beside it (web/cockpit.js).
- Why: two Cancels one above the other, one of them dropping the route, is a trap (Nate: clean where features meet).
- Undo: put `btn('Cancel', () => box.replaceChildren(), 'linkbtn')` back beside Send and drop the early return.
