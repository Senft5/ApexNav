# STATE

## 2026-11-13: Your driving says one finding a skill
- Done: "What your drives say" keeps the strongest finding for each skill (`sayFindings` in `web/driver_profile.js`), so "Back to power is weaker in fast corners" is no longer followed by its mirror "Back to power is stronger in tight corners".
- Next: the rest of Nate's "text walls" on Your driving (the Work on tip, Your style's three sentences).

# CALL SHEET

## 2026-11-13: findings deduplicated on the page, not in the profile
- What: the page shows one finding a skill; `profile().findings` (Python and JS, parity-tested) is unchanged.
- Why: the mirror findings are true but repeat one story; changing the profile would move the parity fixtures and the focus logic for a display question.
- Undo: use `p.findings` instead of `sayFindings(p.findings)` in `render`.
