# STATE

## 2026-11-14 places on the map carry their kind's glyph (behind apex.mapPlaces) (claude/project-thread-5sbga7)
- Done: with places switched on (apex.mapPlaces = '1', still off by default until Nate answers), each place has its kind's glyph before its name: fork and knife, cup, pump, glass, basket, bed, car, flag (cockpit.js PLACE_GLYPH, PLACE_GLYPH_OF, placeGlyphs). They are drawn on a canvas in the look's label ink over its halo and redrawn when the look changes (restyleBasemap).
- Tests: e2e "places on the map" (a glyph for each kind, the café's in the layer, the name after it).
- Next: Nate's answer on the card; yes = make placesFlag default true.

# CALL SHEET

## 2026-11-14 place glyphs drawn on a canvas, not a sprite
- What: placeGlyphs() makes 20 pt images (16 pt glyph, 1.75 stroke on the 24 grid, BRAND.md Icons) with Path2D, addImage/updateImage per look; `icon-image` matches the poi class, `pl-sight` for attractions and museums.
- Why: Apple Maps marks each place by its kind, so a café reads as a café before you read its name. A canvas keeps the glyphs in the look's own ink with no sprite file to keep in step with the themes.
- Undo: drop icon-image and the text-anchor and offset from the layer, and placeGlyphs.
