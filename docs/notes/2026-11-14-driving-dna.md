# STATE

## 2026-11-14 Share my DNA: Your driving as one picture
- Done: once all six skills on Your driving are measured, a "Share my DNA" button sits beside its title. It sends a 9:16 picture through the drive card's share sheet (or saves it): the six skills on a hexagon in the corner's own order, with ▴/▾ where a skill surely moved since the first month read; your style in three words ("Trail-braker · Late apex · Gentle off the brakes"); your best skill; the kind of corner you are cleanest in; and what came up most since you started. web/dna_card.js (pure model + drawing), tests/test_dna_card.py, e2e in the two Your driving flows.
- Next: set your DNA beside a friend's (needs the skills shared through the backend, which is a migration and a sharing switch), and post the card to a crew through the Social thread's post path.

# CALL SHEET

## 2026-11-14 The DNA card leaves out Pace
- What: the picture has the six technique skills only, never Pace, a speed or a time. Why: the drive card's guardrail (no speed brag on a shared picture). How the car is driven travels, not how fast. Undo: dna_card.js SKILLS.

## 2026-11-14 No DNA card until all six skills are measured
- What: the button stays hidden while any skill still reads "--". Why: a hexagon with an unmeasured corner drawn at 0 (or left out) would show a shape that was never measured. Undo: dna_card.js dnaModel's first line.
