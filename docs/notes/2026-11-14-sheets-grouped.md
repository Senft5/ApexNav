# STATE

## 2026-11-14: Vetta sheets rise rounded, settings read as grouped lists
- In the Vetta look, card sheets (Report a hazard, and the others built on `.card-sheet`) and side pop-ups now have rounded top corners (`--r-sheet`) and the raised shadow (`--elev-2`), so they lift off the map instead of looking pasted on.
- Settings rows (`.nav-rows`) are now inset grouped lists: each group is a raised, rounded block with a hairline between rows, and the group labels sit just above it. Before, they were full-width rows with rules.
- Newly possible: Settings scans the way it does in iOS Settings, one block per group; sheets read as layers above the map.
- CSS only (`web/system.css`), scoped to `[data-theme="roadbook"]`, so other looks are unchanged. Shots: /mnt/project-files/ui-thread/sheets-grouped-settings.png.

## 2026-11-14: the empty Log stands in the middle and says what it's for
- A new driver's Log was a pencil card and a head hung at the top of a blank page. Now, in the Vetta look, it sits in the middle of the page, with a bigger head.
- The pencil card draws the road's shape, dashed, where the first drive's line will go, as the end card does.
- One line says what the number is: "Vetta scores each drive out of 1000."
- Nothing in it reads as a result: there are no figures, and unknown values stay "--".

# CALL SHEET

## 2026-11-14: grouped settings in the Vetta look only
- What: rounded, raised groups for the settings rows and rounded sheets, in the main look only.
- Why: the redesign gives Vetta a real system (cards, keys, sheets). The other looks keep their own character.
- Undo: delete the `.card-sheet`, `.side-pop` and `.nav-rows` rules at the end of `web/system.css`.
