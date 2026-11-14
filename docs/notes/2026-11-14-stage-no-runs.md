# STATE

## 2026-11-14 Stages: a stage with no runs says so

- **Done:** in Log → Stages, every stage card showed "-- best" in its corner and "10.6 mi · 0 runs" under its name, even
  when nothing had been driven on it. A stage with no runs now shows only its name and "10.6 mi · no runs yet" under it.
  A stage with runs is unchanged.
  - New e2e flow "Stages: a stage with no runs says so under its name…". It fails on main.
- **Active bugs:** none known.
- **Next:** keep walking the phone screens.

# CALL SHEET

## 2026-11-14 No "-- best" on a stage with no runs

- **What:** analysis_page.js `renderSegments` hides the score and "best" spans when a stage has no passes, and puts the
  length line across the card's full width, under the name.
- **Why:** Nate's standing UX rule asks for clean screens, and three "-- best" in a column read as broken data.
- **Undo:** remove the `if (!passes.length)` line and set the text back to `${passes.length} run(s)`.
