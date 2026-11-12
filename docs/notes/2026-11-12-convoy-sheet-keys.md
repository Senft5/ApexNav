# STATE

## 2026-11-12 Convoy sheet: fewer keys, fewer words

- Done: the leader's row of keys loses New link, which now sits under the QR code beside Hide (it replaces that code, so it redraws it). The line under the "Convoy" title no longer starts "Convoy ·": it reads "You're leading · 1 h 59 min left" (a named convoy keeps its name first). Before a convoy starts, the note is one line ("Drive together, live, up to six cars."); how friends join, the crew run and the extra hour moved into How this works. e2e checks the key layout and the line.
- Next: keep decluttering the social surfaces (Nate 2026-11-12, no walls of text).

# CALL SHEET

## 2026-11-12 New link lives with the QR code

- What: moved the leader's New link key from the convoy's action row into the QR panel; it confirms, makes the new link, copies it and redraws the code.
- Why: six keys in two rows on a small sheet; New link is rare and only means something next to the code it replaces.
- Undo: put the `btn('New link', …)` back on `actions` in `renderHost` in web/convoy_ui.js.
