# STATE

## Place card: Go, then a row of tiles (UI thread, 2026-11-16)
- The card for a tapped place or a dropped pin had a mix of grey text keys: Call and Website as a pair, a left-aligned Go, then Start from here, Share and Save as a spot wrapping over two lines. Now it is laid out like Apple Maps' place card:
  - Go here (with its drive time) runs across the card, centred.
  - Under it is one row of tiles, each a mark over its word: Call and Website (when known), Share, Save.
  - Start from here, Add via (on a route) and Cancel are plain words at the foot.
- "Open" hours are in ink, as the CSS always meant (a later rule had greyed them).
- Next: offline and routing-error states.

# CALL SHEET

## The place card's Save tile says "Save"
- What: `#pinSaveBtn` shows "Save" and keeps " as a spot" in a visually hidden span, so its name and textContent are still "Save as a spot".
- Why: four tiles fit across a 390 pt phone only with one-word labels; the map-pin-plus mark says "a spot".
- Undo: drop the `pin-more-words` span and the `.pin-tiles` CSS in `web/index.html`.
