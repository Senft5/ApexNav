# STATE
## Session 2026-11-12 (VoiceOver): every e2e flow checks that each control in view has a spoken name (claude/project-thread-g9yher)
- Done: e2e/smoke.js `unnamed(page)` runs at the end of every flow, next to `leftovers`: a visible button, link, field, switch, tab, slider, option or radio whose accessible name has no letter or digit (VoiceOver would say only "button") fails the flow. LAUNCH.md section 3 asks for VoiceOver on every screen (IDEAS U-15); this is the part a test can hold.
- Audit before the guard went in: all 198 flows, every final screen; the only hit was the test's own scratch field (`#e2eField`, now labelled). `A11Y_LOG=1` lists hits instead of failing, for a sweep.
- Not covered: screens no flow ends on, reading order, and larger text. Those stay with the simulator check in LAUNCH.md.

# CALL SHEET
## 2026-11-12: a nameless control fails the flow
- What: enforced in every flow, not a report.
- Why: the sweep found none, so it costs nothing today and stops a new icon key without an aria-label.
- Undo: delete the `unnamed` call in the flow runner of e2e/smoke.js.
