# STATE
## Session 2026-11-12 (roam-c review-fixes): the REVIEW.md 1.2 flow's hazard report keeps a live fix (claude/roam-c-review-fixes)
- CI on #581 failed once at "one tap, no confirm, Undo in the status line" and passed on re-run (4/4 locally). A report
  needs a fix under 10 s old, and a web drive with no fix for 5 s drops back to the replay; the flow fed 40 fixes and then
  none, so a loaded runner could cross either line (the Q-15 flow had the same gap, fixed the same way). The flow now keeps
  a fix coming every 500 ms through the hazard report, and the check prints the key, the toast and the sheet when it fails.
- Next: if it fails again, the printed toast says which line it crossed.
