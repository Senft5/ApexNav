# STATE

## 2026-11-14 Find nearby says which places are open (claude/project-thread-5sbga7)
- Done: the Find nearby list (Gas, Coffee, Food, or "gas near me" typed) now shows each named place's hours under its name ("Open · until 9 PM", "Closed · opens 6 AM"), from its OSM opening_hours. The whole list is one Overpass request (place_info.js lookupMany, raced over the servers as cameras.js does). Unnamed places and unknown hours say nothing. Builds on #770's place card.
- Tests: tests/test_place_info.py (one query for a list; each place gets the nearest element of its name within ~150 m). The e2e "find nearby" flow checks the café says "Open 24 hours", with one query for the list and none for an unnamed place.

# CALL SHEET

## 2026-11-14 hours on the nearby list after the list draws
- What: the list draws at once from the map tiles, then the hours fill in under the names when Overpass answers (up to 8 s); a newer keystroke drops the answer.
- Why: the list must never wait on a third party; hours are extra.
- Undo: drop the ApexPlaceInfo.lookupMany block in cockpit.js renderNearby.
