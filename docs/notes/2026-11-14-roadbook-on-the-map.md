# STATE

## 2026-11-14 A roadbook's roads on the real map (free roamer B)
- Done: a roadbook's page draws its roads over the real streets round them, in the theme's map palette, as a Feed post's line is drawn since post_map.js. Each road sits on a casing so it reads over the streets; the driven ones stay in the accent colour. No map (offline, no WebGL, the map's server failing): the plain lines, as before.
- Code: `overviewFrame` and the casings in web/roadbooks.js; web/cockpit.js hoists the Feed's `mapUnder` (one hidden MapLibre map, still pictures) so the Feed and roadbooks share it.
- Tests: tests/test_roadbooks.py `test_the_real_map_lies_under_the_books_roads` (within a pixel of the drawn lines, Ohio to Norway); the e2e "roadbooks: a planned road goes into a new roadbook" checks the still and the casing (fails on main).
- Next: a crew's roadbook (needs a crew column on roadbooks, a migration).
