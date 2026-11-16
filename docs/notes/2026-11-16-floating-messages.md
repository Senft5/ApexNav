# STATE

## Toasts and the map's note float, rounded (UI thread, 2026-11-16)
- In the Roadbook look, a toast ("Searching…", "Search is offline. Tap the map instead.", every message with a key) and the map's own note ("The map couldn't load…") were square boxes ruled in ink at 12 px, the last of the old look on the map. Both are now rounded and lifted (the look's `--r-key` and `--elev-1`), with no outline, at 14 px. On the move the 15 px rule still wins. `web/system.css`.

# CALL SHEET

## The floating messages take the design system's shape
- What: `[data-theme="roadbook"] .toast` and `.map-note` get `border: 0`, `border-radius: var(--r-key)`, `box-shadow: var(--elev-1)` and 14 px text.
- Why: every other thing floating over the map was already rounded and lifted; these two still looked like the old Roadbook theme.
- Undo: delete the last rule in `web/system.css`.
