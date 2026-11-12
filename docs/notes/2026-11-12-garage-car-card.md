# STATE

## 2026-11-12 Garage: Make daily and Remove move into Edit (free roamer B)
- Walkthrough of Garage, Your cars: each car card carried six keys (cover photo, build thread, Edit, Show to friends, Make daily, Remove), with a red Remove always one tap away.
- Done: the card keeps the photo, the build thread, Edit and the Show to friends switch; Make daily and "Remove from garage" sit at the foot of the car's Edit form, Remove still behind its confirm sheet. e2e "garage: a car card holds the build thread, Edit and Show to friends…".
- Next: keep walking (the Log's drive page on a phone).

# CALL SHEET

## 2026-11-12 Rare car keys behind Edit (free roamer B)
- What: garage_ui.js passes a `.car-rare` row (Make daily, Remove from garage) into form() for the car being edited.
- Why: the owner's clutter rule; destructive and rare actions belong inside Edit, as in iOS Contacts and most social apps.
- Undo: put the two buttons back on the card's action row and drop the `more` argument of form().
