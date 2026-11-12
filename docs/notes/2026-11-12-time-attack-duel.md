# STATE

## Session 2026-11-12 (time attack duel): a duel on the week's loop (claude/project-thread-uwmi4e, after #466)

- [x] Where to? → Time attack → Challenge a friend (entered weeks): `duels.js challengeOn(stage)` picks an accepted friend,
  Time by default, 3/7/14 days; the stage is your copy's id from POST /api/timeattack/enter (idempotent). No backend change.
- Tests: tests/test_time_attack.py wiring; e2e "time attack duel".
- Exact next task: the next social win (push for For you once APNs exists; a crew's roadbook).

# CALL SHEET

## 2026-11-12 (time attack duel): Challenge a friend on the week's loop (claude/project-thread-uwmi4e)

Once you've entered the week's loop, its card has Challenge a friend: an ordinary duel on your copy of the loop, so nothing
new on the server. Won by time by default, because the loop is a time attack; Score is one tap away. The duel's days are
the usual 3, 7 or 14, not tied to the week's end, so a duel can outlast the board. Undo: remove the `challenge` hook in
cockpit.js's time attack mount.
