# STATE

## 2026-11-13 Landscape: a planned route shows its card, not the search sheet over it (claude/project-thread-5sbga7)
- Done: on a phone in landscape, a planned route's sheet still showed Where to?'s two-column search section (Best roads nearby, Tap the map, the loop dial, Spots, Time attack, Roadbooks) with the route card pushed below it, out of sight; only the title, Cancel and Start said a route was planned. Since 2026-11-10 (landscape item 14) the section's display: grid out-ranked .plan.routed's display: none. The grid now applies only while no route is planned.
- Tests: new e2e flow "landscape: a planned route is the card alone" (fails on the old CSS); "landscape mount", "safe areas (landscape)", "Dynamic Type", "desk".
- Next: in landscape the routed sheet covers the whole map (on purpose since 11-10, "no half card on a short screen"), so the route itself can't be seen beside its card; worth a side-by-side layout.

# CALL SHEET

## 2026-11-13 landscape's two-column search grid is for the unrouted sheet only
- What: index.html landscape block: `.plan.open:not(.routed) .plan-search-section { display: grid; … }` (was `.plan.open`).
- Why: equal specificity and later in the file, so it beat `.plan.routed .plan-search-section { display: none }`.
- Undo: drop `:not(.routed)`.
