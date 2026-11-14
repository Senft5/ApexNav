# STATE

## 2026-11-14 Place card keys in one row (claude/project-thread-5sbga7)
- Done: on the place card, Go here stays across the card. Start from here, Share and Save as a spot (and Add via during a plan) now sit in one row of short keys under it, as Apple Maps sets them. Before, they were four full-width rows. The card is about 180 px shorter, so the photo, name and hours sit higher. A larger text size wraps the keys two to a row. Every key is still at least 48 px tall.
- Tests: e2e "places on the map", "a pin has a name", "Dynamic Type", "a place someone sent" and "the place card says how long" all pass. The screenshot is in project files at ui-thread/place-card-keys.png.

# CALL SHEET

## 2026-11-14 Place card secondary keys as a row
- What: index.html .pin-actions is now a grid with auto-fit columns of at least 96 px. #pinGoBtn and Cancel span the full row.
- Why: Nate's standing rule against walls; the card read as a list of buttons.
- Undo: put back `.pin-actions { display: grid; gap: 8px; }` and the left-aligned full-width .ink-btn rule.
