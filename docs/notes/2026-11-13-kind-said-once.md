# STATE

## 2026-11-13 Where to?'s list says a row's kind once per run (claude/project-thread-5sbga7)
- Done: with nothing typed, every row of Where to?'s list said "Recent" down the right edge (three, then six while typing). The kind now shows on the first row of a run of the same kind and is blank under it, as a list under a heading reads; each blank row still reads its kind aloud ("Tellico Plains, Recent"). Pinned labels and Saved routes' lengths differ row to row, so they still show.
- Tests: pytest; e2e "Where to? while typing" (now checks the kinds and their aria-labels), "plan flow (a)", "Where to?: your own stages", "Where to?: a suggestion builds", "saved for offline", "Where to? opens at once".
- Next: keep sweeping Where to? and the route card.

# CALL SHEET

## 2026-11-13 a run of the same place kind is labelled once
- What: cockpit.js paintPlaces: with nothing typed, a row whose kind equals the row above's shows no kind and gets an aria-label "<name>, <kind>".
- Why: the same word six times down one edge is noise (Nate's "cluttered" note, 2026-11-12); search results (something typed) keep a kind on every row, since they mix.
- Undo: drop the `rows[i - 1].kind === p.kind` test and the aria-label line.
