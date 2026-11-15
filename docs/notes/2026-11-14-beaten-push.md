# STATE
## 2026-11-14 A push when someone beats you
- Done: "Topped" reaches your phone when a friend's or crew-mate's run goes over your best Score on a stage you both
  have (only if the run is published to you, the board's own rules), and "Time attack" when an entrant goes quicker than
  you this week on a fixed time attack. Told once, as they go past you; never to or from someone blocked; never a time
  or a gap. Its own switch, Someone beat you (`beaten` in `PUSH_GROUPS`). `afterTopped`, `afterPassed`, `bestBefore` in
  `backend/src/push.ts`; `fixedRuns` hands back each circuit's quickest-before. No migration.
- Next: Challenge back / Rematch on a ghost duel once the analysis thread's #782 merges.

# CALL SHEET
## 2026-11-14 No time on a "beaten" push
- What: the time attack push says "@bob went quicker than you on Dry Ridge Road loop.", without the gap For you shows.
- Why: APP_REVIEW 4.5.4 promises a push never holds a time; a lock screen is seen by others.
- Undo: add the gap back to `PUSH.passed` (push.ts) and the APP_REVIEW row.
