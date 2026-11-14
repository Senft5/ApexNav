# STATE

## 2026-11-14 places on the map wait for the owner's yes (claude/project-thread-5sbga7)
- Done: the `apex-places` layer (#694) is drawn only with `apex.mapPlaces = '1'` in localStorage (cockpit.js placesFlag / placesShown); by default the map shows no places, as before #694.
- Tests: e2e "places on the map" checks it is off by default, then switches the flag on and runs the layer, tap and drive checks as before.
- Next: when Nate answers the decision card "Show restaurants, cafés and gas stations on the map when zoomed in?": yes, make placesFlag default true (and drop the off-by-default check); no, remove the layer and its tap handler.

# CALL SHEET

## 2026-11-14 places on the map off by default until Nate answers
- What: placesFlag() gates the layer's visibility; the code, the tap card and the tests stay.
- Why: #694 shipped it on while the decision card was open; the coordinator asked that it not be on by default before Nate answers, ready to switch on.
- Undo: make placesFlag return true unless the key is '0'.
