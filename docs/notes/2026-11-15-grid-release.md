# STATE
## Session 2026-11-15 (grid release): the lower 48 rescored with the nationwide grid can publish (claude/project-thread-39xbx9)
- Bug fixed: graph-us run 43673897128 built all 141 bands scored with the lower 48's context grid (traffic counts, fatal crashes, noise, parks), and its publish refused them: each band's build id carried the hash of its own cut of the grid's index (tools/ctx_etl/fetch.py), 141 different tags.
- Done: tools/ctx_etl/fetch.py stamps the cut with the release's id (`release`, the whole index hashed); tools/graph_etl/build.py ctx_tag uses it; tools/graph_etl/merge_index.py merges blocks whose ids differ only in that tag as one build.
- Next: dispatch graph-us.yml on main with bands_from=43673897128 (band artifacts keep 3 days), then famous_roads.js and the loop survey on the new build.

# CALL SHEET
## 2026-11-15 (grid release): ids that differ only in the grid tag are one build
The tag says which grid scored the roads; the roads, edges and cross-tile ids come from the same OSM extracts and code, so the bands agree. A different road build (date, model) is still refused. Undo: drop same_build in merge_index.py (and the run's bands must be rebuilt).
