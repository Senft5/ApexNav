# STATE

## 2026-11-12 the measured-roads toast is one line (claude/project-thread-5sbga7)
- Done: switching on measured roads in Layers toasted three sentences (196 characters) that vanish before they can be read. It now reads "Green smooth, amber fair, red rough. No line yet? Map it first for extra points." Tapping a road still explains what was measured.
- Tests: pytest; e2e flows matching "Layers" and "measured".
- Next: keep sweeping the shell's toasts.

# CALL SHEET

## 2026-11-12 shorter measured-roads toast
- What: one toast string in web/cockpit.js (the coverage switch).
- Why: Nate's no-walls-of-text rule; a toast is one glance. "Bolder the surer" and "tap one" were dropped: the tap is discoverable, and the line weights speak for themselves.
- Undo: restore the old string.

## 2026-11-12 Where to?'s time attack row peeks again once the account answers
- What: web/cockpit.js calls peekTimeAttack() when a member's /api/me lands while Where to? is open; the e2e time attack flow now answers /api/me 2 s late.
- Why: CI on this PR timed out on the time attack flow. The row's peek ran when the sheet opened, skipped because the account wasn't back yet, and nothing tried again, so the row never named the loop. Reproduced locally by delaying /api/me; fails without the fix, passes with it.
- Undo: remove the one call (the row then fills only on the next open).
