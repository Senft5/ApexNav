# STATE
## Session 2026-11-14 (OSM route context, lower 48): the first full run (claude/roam-c-osm-ctx-us-swap)
- The first full run of osm-ctx-us.yml (run 43623553516) built 149 of 150 chunks in about 2 hours. The New York chunk (43_-76) lost its runner mid-build, most likely out of memory. Because one band job failed, the publish job was skipped and nothing was uploaded.
- Fix: the band jobs get 12 GB of swap, as graph-us.yml's do. Publish now runs whenever the plan succeeded and the run wasn't cancelled, so one failed chunk no longer holds back the rest of the country.
- Next: run it again on main and spot-check a tile outside the region on prod.

# CALL SHEET
## 2026-11-14 (OSM route context, lower 48): publish what built (claude/roam-c-osm-ctx-us-swap)
A failed chunk's cells keep last week's files, or go to Overpass when there are none, which is what happens today. Holding back 149 chunks for one would leave the whole country on Overpass. Undo: set publish's `if:` back to `github.ref == 'refs/heads/main'`.
