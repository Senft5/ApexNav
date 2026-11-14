# STATE

## 2026-11-14 Small phones in a drive: the map keys clear the map's credit (claude/project-thread-5sbga7)
- Fixed: on a small phone (iPhone SE, 375 × 667) in a drive, the map between the strip and the gauges is about 230 px tall. The keys under Layers (Recenter, and the new route overview) started 38 % down it, so at drive size they lay over the map's credit key (the "i" for OpenStreetMap's attribution) at its bottom right. The right-hand keys now start at 38 %, or higher where 184 px (the Layers tab, a key at drive size, the credit) wouldn't fit under that. On a normal phone nothing moves.
- Tests: e2e "the turn arrow and route overview" goes to 375 × 667 mid-drive and checks the overview key ends above the credit and Layers sits above the key, inside the map. It fails with the old 38 %. The "compass", "small things", "fixed stage", "Dynamic Type", "returning driver" and safe area flows pass.

# CALL SHEET

## 2026-11-14 One --keys-top for the right-hand keys
- What: `#app { --keys-top: min(38%, calc(100% - 184px)) }` in index.html, used by .edge, #recenterBtn, #compassBtn and #overviewBtn.
- Why: it moves the whole stack together, so the keys never overlap each other, and the credit stays visible as OSM's licence asks.
- Undo: set --keys-top back to 38 %.
