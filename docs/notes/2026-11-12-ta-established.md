# STATE
## Session 2026-11-12 (security pass, time attack loops): only an established member sets an area's loop (claude/project-thread-4lms1f)
- backend/src/ta_fixed.ts: GET /api/ta hands `make` (the slot to build) only to a member who was invited or has been one
  a week (`establishedSql`, new in reports_sql.ts); POST /api/ta/circuit from anyone else is a 403 `not_yet` while the slot
  is empty. backend/src/time_attack.ts makeCircuit (the weekly loop, older builds) checks the same.
- Tests: ta_fixed.test.ts (+1), time_attack.test.ts (+3 lines).
- Next in the pass: a single established member can still draw one loop by hand (the server can't route); a report from
  three established members hides it and the owner takes it down. Checking the loop against the graph tiles would close it.

# CALL SHEET
## 2026-11-12 (security pass, time attack loops): a new account can't set a season's time attack loop (claude/project-thread-4lms1f)
The server can't route, so it keeps the first loop a phone posts for a slot, and the seed doesn't bind the geometry. A fresh
account could post a hand-drawn loop through a neighbourhood and it would stay the area's time attack for three months.
Now only a member who was invited or has been a member a week is asked to build one or may post one, the same bar a
reporter needs to count. A new area waits up to a week for its loops if nobody there was invited. Undo: drop the two
`established` checks in ta_fixed.ts and the one in time_attack.ts makeCircuit.
