# STATE

## 2026-11-13 A drive's page: the corner list folds after eight

- **Done:** a drive's page listed every corner as a card. A 36-corner road was five phone screens of cards, the same
  coasting tip repeating on a dozen of them. With more than ten corners, the list now shows the first eight, then one
  key: "All 36 corners".
  - Picking a folded corner on the drive's map, or on the lanes, opens the list, so its card is there to read.
  - The e2e flow "a drive's corners on a road driven four times" checks the fold, the key and the unfold on a map pick.
    It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-13 The corner list folds at eight

- **What:** drive_view.js has `CORNERS_SHOWN = 8`. The list folds only when there are more than ten corners, so a key
  never hides just one or two. The CSS rule `.dv-corners.folded > .dv-corner:nth-child(n+9)` is in analysis.html.
  `move()` unfolds the list when the highlighted corner is a folded one.
- **Why:** Nate's standing UX rule bans walls of text. The list was the longest thing on the page, and the map, the
  lanes and "Where to find time" already point at the corners that matter.
- **Undo:** remove the `if (d.corners.length > CORNERS_SHOWN + 2)` block in drive_view.js `mount`.
