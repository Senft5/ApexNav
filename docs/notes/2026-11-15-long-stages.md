# STATE
## Session 2026-11-15 (long stages): loops and Best roads nearby find the famous roads, and Moab's loops keep off 4x4 track (claude/project-thread-39xbx9)
- Done: web/graph_router.js explore chains a road across a tile's edge (sameName: a name's index is its tile's own), up to K.STAGE_KM (40, was 15), and tries every seed, not only the first 36 chains. From Robbinsville Best roads nearby now lists the Cherohala Skyway (26 km) and the Dragon; Asheville's loop takes NC 63 and NC 209 instead of Tunnel Road (goodness 0.46 to 0.51); Angeles Crest is one 24 km stage.
- Done: loops with unpaved road avoided try the stages for other lengths (K.LOOP_DIRT_TRY) when every loop found drives it: Moab at 150 km was Island in the Sky down the Shafer Trail (46 km of 4x4 track), now the paved La Sal Loop. Where none is clean, only the loops with the least unpaved road stay (Sturgis 2.3 km, not 19.7).
- Bug: Ouray at 150 km still gives a ring with 56 km unpaved and 0.82 retraced (no paved loop of that length exists there).
- Next: the graph-us rescore with the lower-48 context grid (osm_from=43629873458), then famous_roads.js again.

# CALL SHEET
## 2026-11-15 (long stages): stages up to 40 km, every seed tried
A famous road is long and sweeping; at 15 km and the first 36 chains, short lanes with more corners per km always won. 40 km keeps a stage a road you'd name; explore costs about 60 ms more. Undo: K.STAGE_KM back to 15 and the `out.length >= max * 3` break back in explore.
