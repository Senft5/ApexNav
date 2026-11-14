# STATE

## 2026-11-14 Roadbook thumbnails on their streets (free roamer B)
- Done: each road's thumbnail on a roadbook page now sits on its own streets (the shared hidden map, post_map.js), drawn once its row comes within a screen of view; the book's map draws its lines thicker (3.5) so they read over a city; the stage chips under "Add one of your stages" have a "Your stages" heading.
- Code: web/roadbooks.js (`nearby`, the thumbnail's `mapUnder` call, `pick`).
- Tests: the e2e "roadbooks: a planned road goes into a new roadbook" checks a thumbnail's still (fails on main); checked by eye on a 390 px screenshot.
- Next: a crew's roadbook (needs a crew column on roadbooks, a migration).
