# STATE
## Session 2026-11-15 (road library, big bet #6): a public page for every great road at vettadrive.app/roads (claude/project-thread-dpdmcn)
- Done: `tools/road_library.js` builds `web/data/road_library.json` from our live road graph. For each of 74 driving areas (rider hubs and where members live) it runs Best roads nearby's own search (graph_router.js explore, 45 min, unpaved avoided), keeps the 10 best named roads of 5 km or more, counts corners as the route card does (detectCorners on the line at 5 m), and drops a road two areas both found.
- `backend/src/road_library.ts` draws the pages on the Worker, with no script: `/roads` (states, then each area's roads), `/roads/<state>`, `/roads/<road>` (name, near, miles, corners, corners a mile, the road's shape north up, Drive it in Vetta = the road's own `#road=` link, more near it) and `/roads/sitemap.xml`. vettadrive.com/roads goes to vettadrive.app. `wrangler.jsonc` run_worker_first has `/roads`, `/roads/*`. No migration, no database read.
- Every page says the map data is OpenStreetMap's; nothing on it is measured or anyone's.
- Tests: backend/test/road_library.test.ts; tests/test_road_library.py.
- Next: a 1200 x 630 card image per road for link previews (the icon now), the crowd's measured road feel on a road's page once there is enough, a Roads link in the app, and submitting the sitemap to search engines (owner: Search Console).

# CALL SHEET
## 2026-11-15 (road library): built from our graph into a committed JSON, drawn on the Worker
- What: the library is a file in the repo (~0.5 MB), rebuilt by hand with `node tools/road_library.js`; pages are server-drawn HTML with an SVG of the road's shape, not a map.
- Why: no CI, R2 or database work; a page never waits on a build; a search engine and a link preview read the page as it is. A map picture per road needs a renderer (next).
- Undo: drop `/roads` from wrangler.jsonc run_worker_first and the roadLibrary call in backend/src/hosts.ts.
## 2026-11-15 (road library): a road's place is "near" an area, not a state
- What: pages say "Near Cincinnati, OH", and ids are name + area (`ky-22-cincinnati`).
- Why: the graph has no state boundaries; a road found from Cincinnati may be in Kentucky.
- Undo: add a state lookup to tools/road_library.js.

## 2026-11-15 (road library cards): a shared road's link shows the road on the map
- What: `tools/road_cards.js` draws a 1200 x 630 JPEG per road (OpenFreeMap's dark map, the road in red on a white casing, name, miles, corners, near, VETTA). `.github/workflows/road-cards.yml` runs it when the library changes on main (or on demand) and uploads each card to R2 `roads/v1/<id>.jpg` through `PUT /api/ops/data` (GitHub OIDC, JPEG only). `/roads/<id>.jpg` serves it; the road's page names it as og:image (summary_large_image) when R2 has it, else the app icon.
- The library's lines are now Douglas-Peucker in metres (8 m, at most 160 points) instead of 60 even points, so hairpins keep their shape on the page and the card.
- Undo: delete the workflow; pages fall back to the icon by themselves.
