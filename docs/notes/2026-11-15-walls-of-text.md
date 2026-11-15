# STATE
## Session 2026-11-15 (walls of text): every flow's last screen fails on a block of over 40 words (claude/project-thread-dpdmcn)
- Done: `wallsOfText` in e2e/smoke.js runs on every flow's last screen, beside the cut-text and text-over-text checks. A paragraph, list item, cell, label or span in view whose own words (its text and inline children) pass 40 fails the flow. `WALL_LOG=1` lists instead.
- The survey of all ~314 flows found 3 blocks: two list items in the privacy policy (a document, exempt with terms and support) and the owner-only Service check's result line, which named all 21 feeds that were down (offline, every feed is).
- Fix: `ApexServiceCheck.summary` names at most three down feeds and says "and N more"; the rows below list each one. Test in tests/test_service_check.py.
- Next: another roam item.

# CALL SHEET
## 2026-11-15 a wall of text is over 40 words in one block, policy pages exempt
- What: the threshold is 40 words; privacy, terms and support pages are skipped.
- Why: the owner's rule (2026-11-12) bans walls of text; the app's screens already sit under 40 everywhere, so the check keeps it that way. A policy is read as a document.
- Undo: raise `WALL_WORDS` in e2e/smoke.js, or set `WALL_LOG=1` to only list.
