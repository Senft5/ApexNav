# STATE
## Session 2026-11-15 (Garage at large text): every setting page and the Stages list at 2x, on a 390 phone and a 320 pt one (claude/project-thread-dpdmcn)
- Done: a new e2e flow, "large text in the Garage", opens every setting the Garage lists (taken from the page, so a new one is swept too) and the Stages list at 2x text. It runs on a 390 phone and on a 320 pt phone (an SE or mini with Display Zoom). It reads them with the same checks as the large text sweep: cut text, keys under 24 px, words over words, and a page wider than the phone.
- Fixed, found by it: at 320 pt and 2x a switch's long word was cut. "Kilometres and metres" (Units) lost 12 px, and "Steady" (Map motion) ran into Lean. At large text each switch key is now at least as wide as its longest word, and the keys wrap to a second row rather than cut it. 1x is unchanged.
- Tests: the new flow; the five text-size flows; with the fix reverted, the flow names both cuts.
- Next: another roam item.

# CALL SHEET
## 2026-11-15 at large text a switch's keys size to their words and may wrap
- What: index.html `html[data-type-size] .switch { flex-wrap: wrap } .switch > button { flex: 1 1 auto; min-width: min-content }`.
- Why: equal-width keys can't hold "Kilometres" at 2x on a 320 pt phone, and a word cut mid-letter reads as a different word. Wrapping is what iOS does at the accessibility sizes.
- Undo: delete the rule (the keys go back to equal widths, and the Garage flow names the cuts again).
