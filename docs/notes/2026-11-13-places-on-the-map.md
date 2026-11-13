# STATE

## 2026-11-13 places on the map, a tap is their card (claude/project-thread-5sbga7)
- Done: the map shows named places a driver stops for (eateries, cafés, bars, bakeries, fuel, groceries, lodging, car shops, attractions, museums) from zoom 15 in, in the map's own label ink set in italic, under the street and town names (they win a clash), never in a drive (`apex-places`, cockpit.js addApexLayers / applyPlaces). The base style's POI layers stay hidden (basemap.js), and the car's map is unchanged. A tap on a place opens the dropped pin's card with its name, kind and how far, and no reverse geocode: Go here, Start from here, Add via, Save as a spot.
- Tests: e2e "places on the map" (the layer: zoom 15, italic, under the street names; a tap gives the card by name, kind and distance; hidden in a drive).
- Next: Nate's call on the decision card (show places or keep the map bare); if bare, drop the layer (Undo below).

# CALL SHEET

## 2026-11-13 places drawn close in, never in a drive
- What: the `apex-places` symbol layer on the vector tiles' `poi` layer, PLACE_CLASSES, minzoom 15, Noto Sans Italic, before the first base symbol layer; hidden in live mode; its tap → showPin(point, { name, kind }).
- Why: the map hid every place, so a restaurant you could see in Apple or Google Maps could not be found or tapped here. Close in only, and off in a drive, keeps the drive view clean. Asked Nate on a decision card and built the recommended option meanwhile.
- Undo: remove the `apex-places` addLayer and its click handler (showPin's place argument is harmless alone).
