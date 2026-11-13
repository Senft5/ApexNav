# STATE

## Session 2026-11-13 (carplay places): the car's Places list matches Where to? (claude/project-thread-me97iw)
- The car's Places showed recents only. It now lists pinned places first (Home, Work; the address under the name), then up to 4 saved routes ("Saved · 12 mi"), then recents, one row per name, at most 12 (carplay.js `placesMessage`, cockpit.js `carPlaces`).
- A saved route tapped on the car sends `{action:'saved', id}` and the phone opens its own copy (`openSaved`), so it works with no signal. Pin, unpin, save and remove re-send the list.
- Next: keep checking phone/car parity.
