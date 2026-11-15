# STATE

## 2026-11-14 Your driving DNA beside a friend's
- Done: the phone sends your Driving DNA (web/dna_card.js `wireOf`: six skill levels, style words, cleanest corner kind, counts) to `PUT /api/me/dna` when it changes (analysis_page.js `syncDna`, members only). A friend's profile shows "Driving DNA": their hexagon filled and yours outlined, the skills named round it, their style, and where each of you leads (a skill 5 points apart or more). Only while that friend shares Scores with you, never across a block. Migration 0064 (`driver_dna`). Tests: backend/test/dna.test.ts, tests/test_dna_card.py, e2e "friend profile".
- Next: the same comparison on a crew page (the crew's DNA spread), and the Share my DNA picture with a friend's shape over yours.

# CALL SHEET

## 2026-11-14 A friend sees your DNA under the Scores switch
- What: your DNA is shown to a friend exactly when your Scores are (their friend grant's `share_scores`); no new switch. Why: it is read from the same scored corners, and one more switch is clutter (the owner's 2026-11-12 UX rule). Undo: backend/src/dna.ts `dnaPair`.

## 2026-11-14 The server keeps only what the card shows
- What: `dnaOf` keeps the six levels, known style words, the corner kind and two counts; anything else the phone sends (pace, a speed) is dropped. Why: the drive card's guardrail, no speed brag. Undo: dna.ts `dnaOf`.
