# STATE

## 2026-11-13: Lead and Sweep are one list on a crew drive
- Done: in a crew drive's Set it up, the Lead and Sweep pickers sit as one list with a single rule between them. Before, each row drew its own top and bottom rule with an 8 px gap, so a doubled line split them. controls.css also drops the top rule of any row-pick that comes straight after another one, so stacked pickers elsewhere read the same way. The e2e crew drives flow checks no gap and no second rule.
- Next: keep looking for doubled rules and stray gaps on the social screens.

# CALL SHEET

## 2026-11-13: one rule between stacked pickers
- What: `.row-pick-list` (a grid, no gap) wraps Lead and Sweep in web/crew_events.js; `.row-pick + .row-pick-native + .row-pick { border-top: 0; }` in web/controls.css.
- Why: a doubled rule looked sloppy (Nate: every place features meet must be clean).
- Undo: put `stack-8` back on rolesRow and delete the two CSS rules.
