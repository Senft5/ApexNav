# STATE

## 2026-11-16 A crew's sheets say what can't load the same way
- Done: the crew page, its members, board and chat, and the crews dashboard's feed say what couldn't load in one line with Try again (`crew_page.js` `lostLine`); the board and the chat had a line with no key, the dashboard feed a "Loading…" line. e2e "crew page offline: one line and Try again…".
- Next: the screen inventory's Garage rows (your cars as a strip under the profile head).

# CALL SHEET

## 2026-11-16 The full Feed's pick holds when the crews list doesn't load
- What: a Feed drawn while the crews list didn't answer (no list) no longer drops the pick to All, and a Feed drawn over lets go of mutes instead of calling show() and moving the pick; CI flaked on "the full Feed picks…" again after #997.
- Why: either path could set the shared pick back to All under the driver's finger.
- Undo: `web/drive_posts.js` `full()`: drop the `Array.isArray(crews)` return and the `isConnected` check.
- Then: every Feed on the page follows a pick made on any of them (`onPick`), since a Social redraw can swap the Feed under a tap and the old one took the pick; the flow's waits now say which one ran out and what the Feed showed.
