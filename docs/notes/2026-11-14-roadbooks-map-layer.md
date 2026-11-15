# STATE

## 2026-11-14 Your roadbooks' roads on the main map (free roamer B)
- Done: Map layers → Roadbooks (legend Driven / To drive, off by default, members only). It draws the roads of your
  books, your crews' books and the ones you follow on the map: driven ones solid in the look's gain colour, the rest
  dashed in ink, under the planned route. A tap opens the book (Drive it is there; a route over it wins the tap).
- How: web/roadbook_map.js (`inView`, `features`, `mount`), lazy with the social scripts. It picks the books with a road
  whose box touches the view from the lists the phone already holds (GET /api/roadbooks, read once if needed) and opens
  only those (GET /api/roadbooks/:id), at most 6 a move, each once a page; books you stop keeping drop off. No new
  endpoint, no migration, nothing about where you are goes to the server.
- Tests: tests/test_roadbook_map.py; e2e "roadbooks on the map" (only the book in view is asked for, solid/dashed, a
  tap opens it). Startup budget and the Layers legend check pass. Docs: SOCIAL 2.6, IDEAS S-23.
- Next: refresh a book on the map after a road is added or stamped (`roadbookMap.forget(id)` from roadbooks.js).
