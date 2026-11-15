# STATE

## 2026-11-14 The Roadbooks map layer follows your edits (free roamer B)
- Done: after any roadbook write that goes through (a road added or removed, a stamp, a follow, an edit or delete), the
  map's Roadbooks layer forgets the books it opened and reads the ones in view again, so a road you take out leaves the
  map and a road you just drove turns solid without reloading the page.
- How: roadbooks.js calls `page.edited()` from its `call` wrapper on an ok non-GET; cockpit.js debounces it (600 ms, so
  a burst of stamps after a drive reads the books once) into `roadbookMap.forget()`. No new endpoint, no migration.
- Tests: e2e "roadbooks on the map" now removes a road from the open book and checks the map drops it.
- Next: none on this thread of work; roam on.
