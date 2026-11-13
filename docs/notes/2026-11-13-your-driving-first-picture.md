# STATE

## 2026-11-13 Your driving before 30 clean corners: one panel, not six rows of dashes (free roamer B)
- Walkthrough on a phone after one short drive: Your driving showed six skill rows of "--", a "--" Pace and a road panel with nothing to say, a wall of empty values.
- Done: until any skill has a level, web/driver_profile.js render() shows one "Your first picture" panel instead: "23 of 30 clean corners. A few more twisty miles and your skills show here." and a progress bar (SKILL_MIN). The rows, Pace and road panel come back as soon as a skill is known. New e2e flow "Your driving before 30 clean corners" (fails on main).
- Also: in Garage's Co-driver section, "Hear a sample" and "Change in Layers" sat 4 px in from the rows around them (the link key's own padding); `.co-row .linkbtn` drops it at the row's outer edges (web/index.html).
- Next: keep walking on a phone (People with a friend's profile).

# CALL SHEET

## 2026-11-13 Your driving's first picture (free roamer B)
- What: a profile with no known skill shows one progress panel instead of empty rows.
- Why: the owner's rule against walls of text and cryptic screens; "--" six times tells a new driver nothing about what to do next.
- Undo: remove the `first` block in driver_profile.js render() and its two conditions, and the e2e flow.
