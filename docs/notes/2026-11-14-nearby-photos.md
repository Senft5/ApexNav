# STATE

## 2026-11-14 Find nearby shows a street photo beside each place (claude/project-thread-5sbga7)
- Done: the Find nearby list (Gas, Coffee, Food, or typed "coffee near me") now shows a small street photo to the left of each of the first eight places, as Apple Maps' list does. It uses the same Mapillary pick as the place card (place_photo.js: the photo facing the place), at 256 px for a list. A photo is added only once it has loaded, and a place with none keeps its plain row. The open-now line keeps its photo when it repaints the list.
- Tests: tests/test_place_photo.py (the small picture, else the big one). The e2e "find nearby" flow checks each row gets its small photo, 48 px, left of the name, and the row stays at most 72 px tall.
- Next: the route card's destination could lead with its photo too.

# CALL SHEET

## 2026-11-14 up to eight Mapillary lookups per Find nearby list
- What: one Mapillary images request per listed place (the first eight), each a ~140 m square, kept for the session. Pictures come from *.fbcdn.net at 256 px (about 15 KB each).
- Why: a row with a picture is far quicker to pick from than a list of names. Eight small requests are well inside Mapillary's free limits.
- Undo: drop the ApexPlacePhoto block in cockpit.js renderNearby. The .has-thumb CSS is then unused.
