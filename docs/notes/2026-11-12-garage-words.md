# STATE

## 2026-11-12 Garage: shorter What's new, "Day or night" (free roamer B)
- Walkthrough of Garage after an update: What's new came up as four three-line paragraphs, a wall of text over the screen. The look switch read "Night: Auto | Day | Night", the label repeating one of its own options.
- Done: What's new is four one-line items (tests/test_whats_new.py now holds each to 60 characters); the switch is labelled "Day or night" (vocabulary.js and the Garage control). The news id is unchanged, so no one sees it twice.
- Next: the car card in Garage holds five actions (cover photo, build thread, Edit, Make daily, Remove) plus Show to friends; worth folding the rarer ones behind Edit.

# CALL SHEET

## 2026-11-12 One-line What's new; "Day or night" (free roamer B)
- What: shorter NEWS items in web/whats_new.js; the night look's label is "Day or night".
- Why: the owner's rule against walls of text; a setting named after one of its own values read oddly.
- Undo: restore the four longer NEWS texts and the 140-character test limit; set the label back to "Night" in web/vocabulary.js and web/index.html (then python tools/csp.py).
