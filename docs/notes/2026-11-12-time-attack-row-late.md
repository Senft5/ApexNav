# STATE

## 2026-11-12 Where to?'s time attack row fills in when the account answers late (claude/project-thread-5sbga7)
- Done: web/cockpit.js calls peekTimeAttack() when a member's /api/me lands while Where to? is open. The e2e time attack flow now answers /api/me 2 s late, so the race stays covered.
- Tests: the four time attack e2e flows pass; the delayed-account flow fails without the fix.
- Next: Where to? while typing (Nate's TestFlight "evil cluttered gap").

# CALL SHEET

## 2026-11-12 the time attack row peeks again once the account answers
- What: one call to peekTimeAttack() where accountMe is set.
- Why: CI timed out on the time attack flow. The row's peek ran when the sheet opened, skipped because the account wasn't back yet, and nothing tried again, so the row never named the loop. Reproduced locally by delaying /api/me.
- Undo: remove the call (the row then fills only on the next open).
