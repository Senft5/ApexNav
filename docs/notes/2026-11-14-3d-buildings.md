# STATE

## 2026-11-14 the map stands a town's buildings up in 3D (claude/project-thread-5sbga7)
- Done: from zoom 15 the map draws OpenStreetMap's buildings as 3D blocks, as Apple and Google Maps draw a town. The map is already tilted 42-45 degrees at launch, so a town reads as a town instead of a flat diagram. They rise from flat between zoom 15 and 16 at their OSM heights (render_height from OpenFreeMap's own tiles: nothing extra is fetched). The colour is each theme's land, a seventh of the way to the road casing (basemap.js buildingColour): paper blocks on the road book by day, dark blocks by night, a dim teal on Tapedeck. They sit under labels and every line of ours. Low-power mode drops them (HEAVY_LAYERS), and satellite (developers only) fades them to nothing.
- Tests: tests/test_basemap.py (on every theme, day and night, the blocks sit between the land and the ink, nearer the land). Checked by screenshot over downtown Cincinnati, day and night. The startup budget e2e still passes.
- Next: the CarPlay map (MapLibre Native, CarPlay/) still draws a flat town.

# CALL SHEET

## 2026-11-14 3D buildings on the phone's map, on by default
- What: a new apex-buildings fill-extrusion layer in cockpit.js addApexLayers. The style's own building layers stay hidden (basemap.js).
- Why: every big maps app shows a town in 3D when the map tilts. Ours is tilted from launch but showed flat blocks of nothing. The heights come in the tiles we already load. The GPU cost is cut in low-power mode, as hillshade and contours are.
- Undo: delete the apex-buildings addLayer in cockpit.js (and its HEAVY_LAYERS entry). basemap.js then has nothing to paint.
