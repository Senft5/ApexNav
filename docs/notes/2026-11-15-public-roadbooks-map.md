# STATE

## 2026-11-15 Public roadbooks on the map (free roamer B)
- Done: the Roadbooks map layer also draws public roadbooks round the map's view, thin and faint in ink (legend: Public),
  under your own books' roads; a tap opens the book, where Follow is. Good roads other members keep now turn up where
  you are looking, not only in People's Roadbooks near you list.
- How: web/roadbook_map.js `nearInView` (a public book's area in the view grown by half each way, nearest first, your
  own books skipped) and `features(full, pub)` (property p; a road in one of your books is drawn as yours). cockpit.js
  `near(lat, lon)` asks GET /api/roadbooks/near by the coarse cell of the map's centre, the same call Roadbooks near you
  makes, gated by the privacy-zone lookup check, once a cell a page. Still at most 6 books opened a move, yours first.
  No new endpoint, no migration.
- Tests: tests/test_roadbook_map.py (nearInView, public marking); e2e "roadbooks on the map" (the public book opened and
  drawn as public, near asked once by cell only, still there after an edit).

# CALL SHEET

## 2026-11-15 Public roadbooks share the Roadbooks switch (free roamer B)
- What: one Roadbooks switch shows your books and public ones round the view, rather than a second switch.
- Why: Nate's clean-UI rule (fewer switches); public roads are drawn quieter so yours still lead.
- Undo: drop `near:` from the mount in web/cockpit.js; the module draws only your books without it.
